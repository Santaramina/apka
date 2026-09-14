import logging
import uuid
from datetime import timedelta, timezone
from pathlib import Path
from typing import List, Optional

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

from fastapi import APIRouter, Depends, FastAPI, File, Header, HTTPException, Query, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response
from pydantic import BaseModel, EmailStr, Field
from starlette.middleware.cors import CORSMiddleware

import requests

import ai_service
import pdf_service
import storage_service
from db import db, now_utc
from seed_data import seed_user_catalog
from security import create_jwt, get_current_user, hash_password, user_from_token, verify_password

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI()
api = APIRouter(prefix="/api")

EMERGENT_SESSION_URL = "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data"


# ----------------------------- Helpers -----------------------------
def public_user(user: dict) -> dict:
    return {
        "user_id": user.get("user_id"),
        "email": user.get("email"),
        "name": user.get("name"),
        "picture": user.get("picture"),
        "company_name": user.get("company_name"),
        "nip": user.get("nip"),
        "address": user.get("address"),
        "phone": user.get("phone"),
    }


def compute_totals(est: dict) -> dict:
    subtotal = 0.0
    for it in est.get("items", []):
        subtotal += float(it.get("quantity", 0) or 0) * float(it.get("unit_price", 0) or 0)
    markup_pct = float(est.get("markup_percent", 0) or 0)
    discount_pct = float(est.get("discount_percent", 0) or 0)
    vat_pct = float(est.get("vat_percent", 23) or 0)
    markup = subtotal * markup_pct / 100.0
    after_markup = subtotal + markup
    discount = after_markup * discount_pct / 100.0
    net = after_markup - discount
    vat = net * vat_pct / 100.0
    gross = net + vat
    return {
        "subtotal": round(subtotal, 2),
        "markup": round(markup, 2),
        "discount": round(discount, 2),
        "net": round(net, 2),
        "vat": round(vat, 2),
        "gross": round(gross, 2),
    }


def estimate_out(est: dict) -> dict:
    est = {k: v for k, v in est.items() if k != "_id"}
    est["totals"] = compute_totals(est)
    return est


# ----------------------------- Models -----------------------------
class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)
    name: Optional[str] = None
    company_name: Optional[str] = None


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class SessionIn(BaseModel):
    session_id: str


class ProfileIn(BaseModel):
    name: Optional[str] = None
    company_name: Optional[str] = None
    nip: Optional[str] = None
    address: Optional[str] = None
    phone: Optional[str] = None


class ClientIn(BaseModel):
    name: str
    company: Optional[str] = None
    nip: Optional[str] = None
    address: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    note: Optional[str] = None


class ProjectIn(BaseModel):
    client_id: str
    name: str
    address: Optional[str] = None
    trade: str = "mieszane"
    note: Optional[str] = None
    status: str = "active"


class MaterialIn(BaseModel):
    name: str
    category: str = "ogolnobudowlana"
    unit: str = "szt"
    unit_price: float = 0


class LaborIn(BaseModel):
    name: str
    category: str = "ogolnobudowlana"
    unit: str = "godz"
    rate: float = 0


class EstimateItemIn(BaseModel):
    item_id: Optional[str] = None
    kind: str = "material"
    name: str
    unit: str = "szt"
    quantity: float = 1
    unit_price: float = 0
    note: Optional[str] = ""
    source: str = "manual"


class EstimateIn(BaseModel):
    project_id: str
    title: Optional[str] = None
    scope_summary: Optional[str] = ""
    items: List[EstimateItemIn] = []
    markup_percent: float = 10
    discount_percent: float = 0
    vat_percent: float = 23
    status: str = "draft"


class EstimateUpdateIn(BaseModel):
    title: Optional[str] = None
    scope_summary: Optional[str] = None
    items: Optional[List[EstimateItemIn]] = None
    markup_percent: Optional[float] = None
    discount_percent: Optional[float] = None
    vat_percent: Optional[float] = None
    status: Optional[str] = None


class AnalyzeIn(BaseModel):
    project_id: str
    description: Optional[str] = ""
    trade: Optional[str] = "mieszane"
    image_paths: List[str] = []
    audio_path: Optional[str] = None


# ----------------------------- Auth -----------------------------
async def _finalize_user(user: dict):
    await seed_user_catalog(db, user["user_id"])


@api.post("/auth/register")
async def register(body: RegisterIn):
    email = body.email.lower()
    existing = await db.users.find_one({"email": email})
    if existing:
        raise HTTPException(status_code=400, detail="Konto z tym adresem już istnieje")
    user_id = f"user_{uuid.uuid4().hex[:12]}"
    user = {
        "user_id": user_id,
        "email": email,
        "name": body.name or email.split("@")[0],
        "password_hash": hash_password(body.password),
        "company_name": body.company_name,
        "nip": None,
        "address": None,
        "phone": None,
        "picture": None,
        "created_at": now_utc(),
    }
    await db.users.insert_one(user)
    await _finalize_user(user)
    token = create_jwt(user_id)
    return {"token": token, "user": public_user(user)}


@api.post("/auth/login")
async def login(body: LoginIn):
    email = body.email.lower()
    user = await db.users.find_one({"email": email}, {"_id": 0})
    if not user or not user.get("password_hash") or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Nieprawidłowy e-mail lub hasło")
    token = create_jwt(user["user_id"])
    return {"token": token, "user": public_user(user)}


@api.post("/auth/session")
async def google_session(body: SessionIn):
    def _fetch():
        return requests.get(EMERGENT_SESSION_URL, headers={"X-Session-ID": body.session_id}, timeout=30)

    resp = await run_in_threadpool(_fetch)
    if resp.status_code != 200:
        raise HTTPException(status_code=401, detail="Nieprawidłowa sesja Google")
    data = resp.json()
    email = (data.get("email") or "").lower()
    if not email:
        raise HTTPException(status_code=401, detail="Brak adresu e-mail w sesji")

    user = await db.users.find_one({"email": email}, {"_id": 0})
    if not user:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        user = {
            "user_id": user_id,
            "email": email,
            "name": data.get("name") or email.split("@")[0],
            "picture": data.get("picture"),
            "password_hash": None,
            "company_name": None,
            "nip": None,
            "address": None,
            "phone": None,
            "created_at": now_utc(),
        }
        await db.users.insert_one(user)
        await _finalize_user(user)

    session_token = data.get("session_token")
    await db.user_sessions.insert_one(
        {
            "session_token": session_token,
            "user_id": user["user_id"],
            "created_at": now_utc(),
            "expires_at": now_utc() + timedelta(days=7),
        }
    )
    return {"session_token": session_token, "user": public_user(user)}


@api.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return {"user": public_user(user)}


@api.put("/auth/profile")
async def update_profile(body: ProfileIn, user: dict = Depends(get_current_user)):
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if updates:
        await db.users.update_one({"user_id": user["user_id"]}, {"$set": updates})
    fresh = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0})
    return {"user": public_user(fresh)}


@api.post("/auth/logout")
async def logout(user: dict = Depends(get_current_user)):
    return {"ok": True}


# ----------------------------- Clients -----------------------------
@api.get("/clients")
async def list_clients(user: dict = Depends(get_current_user)):
    docs = await db.clients.find({"user_id": user["user_id"], "deleted_at": None}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return docs


@api.post("/clients")
async def create_client(body: ClientIn, user: dict = Depends(get_current_user)):
    doc = body.model_dump()
    doc.update({"client_id": str(uuid.uuid4()), "user_id": user["user_id"], "created_at": now_utc(), "deleted_at": None})
    await db.clients.insert_one(doc)
    return {k: v for k, v in doc.items() if k != "_id"}


@api.get("/clients/{client_id}")
async def get_client(client_id: str, user: dict = Depends(get_current_user)):
    doc = await db.clients.find_one({"client_id": client_id, "user_id": user["user_id"], "deleted_at": None}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Nie znaleziono klienta")
    return doc


@api.put("/clients/{client_id}")
async def update_client(client_id: str, body: ClientIn, user: dict = Depends(get_current_user)):
    res = await db.clients.update_one(
        {"client_id": client_id, "user_id": user["user_id"], "deleted_at": None}, {"$set": body.model_dump()}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Nie znaleziono klienta")
    doc = await db.clients.find_one({"client_id": client_id}, {"_id": 0})
    return doc


@api.delete("/clients/{client_id}")
async def delete_client(client_id: str, user: dict = Depends(get_current_user)):
    await db.clients.update_one({"client_id": client_id, "user_id": user["user_id"]}, {"$set": {"deleted_at": now_utc()}})
    return {"ok": True}


# ----------------------------- Projects -----------------------------
@api.get("/projects")
async def list_projects(user: dict = Depends(get_current_user)):
    docs = await db.projects.find({"user_id": user["user_id"], "deleted_at": None}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    # attach client name
    clients = {c["client_id"]: c for c in await db.clients.find({"user_id": user["user_id"]}, {"_id": 0}).to_list(1000)}
    for d in docs:
        c = clients.get(d.get("client_id"))
        d["client_name"] = c["name"] if c else None
    return docs


@api.post("/projects")
async def create_project(body: ProjectIn, user: dict = Depends(get_current_user)):
    client = await db.clients.find_one({"client_id": body.client_id, "user_id": user["user_id"], "deleted_at": None})
    if not client:
        raise HTTPException(status_code=400, detail="Nieprawidłowy klient")
    doc = body.model_dump()
    doc.update({"project_id": str(uuid.uuid4()), "user_id": user["user_id"], "created_at": now_utc(), "deleted_at": None})
    await db.projects.insert_one(doc)
    return {k: v for k, v in doc.items() if k != "_id"}


@api.get("/projects/{project_id}")
async def get_project(project_id: str, user: dict = Depends(get_current_user)):
    doc = await db.projects.find_one({"project_id": project_id, "user_id": user["user_id"], "deleted_at": None}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Nie znaleziono inwestycji")
    client = await db.clients.find_one({"client_id": doc.get("client_id")}, {"_id": 0})
    doc["client"] = client
    estimates = await db.estimates.find({"project_id": project_id, "deleted_at": None}, {"_id": 0}).sort("created_at", -1).to_list(200)
    doc["estimates"] = [estimate_out(e) for e in estimates]
    return doc


@api.put("/projects/{project_id}")
async def update_project(project_id: str, body: ProjectIn, user: dict = Depends(get_current_user)):
    res = await db.projects.update_one(
        {"project_id": project_id, "user_id": user["user_id"], "deleted_at": None}, {"$set": body.model_dump()}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Nie znaleziono inwestycji")
    doc = await db.projects.find_one({"project_id": project_id}, {"_id": 0})
    return doc


@api.delete("/projects/{project_id}")
async def delete_project(project_id: str, user: dict = Depends(get_current_user)):
    await db.projects.update_one({"project_id": project_id, "user_id": user["user_id"]}, {"$set": {"deleted_at": now_utc()}})
    return {"ok": True}


# ----------------------------- Catalog: Materials -----------------------------
@api.get("/materials")
async def list_materials(user: dict = Depends(get_current_user)):
    return await db.materials.find({"user_id": user["user_id"], "deleted_at": None}, {"_id": 0}).sort("name", 1).to_list(2000)


@api.post("/materials")
async def create_material(body: MaterialIn, user: dict = Depends(get_current_user)):
    doc = body.model_dump()
    doc.update({"material_id": str(uuid.uuid4()), "user_id": user["user_id"], "created_at": now_utc(), "deleted_at": None})
    await db.materials.insert_one(doc)
    return {k: v for k, v in doc.items() if k != "_id"}


@api.put("/materials/{material_id}")
async def update_material(material_id: str, body: MaterialIn, user: dict = Depends(get_current_user)):
    res = await db.materials.update_one(
        {"material_id": material_id, "user_id": user["user_id"], "deleted_at": None}, {"$set": body.model_dump()}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Nie znaleziono materiału")
    return await db.materials.find_one({"material_id": material_id}, {"_id": 0})


@api.delete("/materials/{material_id}")
async def delete_material(material_id: str, user: dict = Depends(get_current_user)):
    await db.materials.update_one({"material_id": material_id, "user_id": user["user_id"]}, {"$set": {"deleted_at": now_utc()}})
    return {"ok": True}


# ----------------------------- Catalog: Labor -----------------------------
@api.get("/labor-rates")
async def list_labor(user: dict = Depends(get_current_user)):
    return await db.labor_rates.find({"user_id": user["user_id"], "deleted_at": None}, {"_id": 0}).sort("name", 1).to_list(2000)


@api.post("/labor-rates")
async def create_labor(body: LaborIn, user: dict = Depends(get_current_user)):
    doc = body.model_dump()
    doc.update({"labor_id": str(uuid.uuid4()), "user_id": user["user_id"], "created_at": now_utc(), "deleted_at": None})
    await db.labor_rates.insert_one(doc)
    return {k: v for k, v in doc.items() if k != "_id"}


@api.put("/labor-rates/{labor_id}")
async def update_labor(labor_id: str, body: LaborIn, user: dict = Depends(get_current_user)):
    res = await db.labor_rates.update_one(
        {"labor_id": labor_id, "user_id": user["user_id"], "deleted_at": None}, {"$set": body.model_dump()}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Nie znaleziono stawki")
    return await db.labor_rates.find_one({"labor_id": labor_id}, {"_id": 0})


@api.delete("/labor-rates/{labor_id}")
async def delete_labor(labor_id: str, user: dict = Depends(get_current_user)):
    await db.labor_rates.update_one({"labor_id": labor_id, "user_id": user["user_id"]}, {"$set": {"deleted_at": now_utc()}})
    return {"ok": True}


# ----------------------------- Uploads / Files -----------------------------
_EXT = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "audio/m4a": "m4a", "audio/mp4": "m4a", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-wav": "wav"}


@api.post("/upload")
async def upload_file(file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    data = await file.read()
    content_type = file.content_type or "application/octet-stream"
    ext = _EXT.get(content_type)
    if not ext and file.filename and "." in file.filename:
        ext = file.filename.rsplit(".", 1)[-1].lower()
    ext = ext or "bin"
    path = f"{storage_service.APP_NAME}/uploads/{user['user_id']}/{uuid.uuid4().hex}.{ext}"
    await run_in_threadpool(storage_service.put_object, path, data, content_type)
    await db.captures.insert_one(
        {
            "capture_id": str(uuid.uuid4()),
            "user_id": user["user_id"],
            "storage_path": path,
            "content_type": content_type,
            "filename": file.filename,
            "created_at": now_utc(),
        }
    )
    return {"path": path, "url": f"/api/files/{path}", "content_type": content_type}


@api.get("/files/{path:path}")
async def get_file(path: str, token: Optional[str] = Query(None), authorization: str = Header(None)):
    # auth via bearer header or ?token= (web images can't send headers)
    bearer = None
    if authorization and authorization.startswith("Bearer "):
        bearer = authorization[7:]
    user = await user_from_token(bearer or token or "")
    if not user:
        raise HTTPException(status_code=401, detail="Brak autoryzacji")
    cap = await db.captures.find_one({"storage_path": path, "user_id": user["user_id"]}, {"_id": 0})
    if not cap:
        raise HTTPException(status_code=404, detail="Nie znaleziono pliku")
    content, ctype = await run_in_threadpool(storage_service.get_object, path)
    return Response(content=content, media_type=ctype)


# ----------------------------- AI Analyze -----------------------------
@api.post("/ai/analyze")
async def analyze(body: AnalyzeIn, user: dict = Depends(get_current_user)):
    project = await db.projects.find_one({"project_id": body.project_id, "user_id": user["user_id"], "deleted_at": None}, {"_id": 0})
    if not project:
        raise HTTPException(status_code=404, detail="Nie znaleziono inwestycji")

    images = []
    for p in body.image_paths[:8]:
        cap = await db.captures.find_one({"storage_path": p, "user_id": user["user_id"]})
        if not cap:
            continue
        content, ctype = await run_in_threadpool(storage_service.get_object, p)
        images.append((content, ctype))

    audio = None
    if body.audio_path:
        cap = await db.captures.find_one({"storage_path": body.audio_path, "user_id": user["user_id"]})
        if cap:
            content, ctype = await run_in_threadpool(storage_service.get_object, body.audio_path)
            audio = (content, ctype)

    if not images and not audio and not body.description:
        raise HTTPException(status_code=400, detail="Dodaj zdjęcie, nagranie lub opis")

    try:
        result = await ai_service.analyze_site(
            session_id=f"analyze_{uuid.uuid4().hex[:8]}",
            description=body.description or "",
            images=images,
            audio=audio,
            trade=body.trade or project.get("trade", "mieszane"),
        )
    except Exception as e:
        logger.exception("AI analyze failed")
        raise HTTPException(status_code=502, detail=f"Analiza AI nie powiodła się: {e}")

    items = []
    for it in result["items"]:
        items.append({**it, "item_id": str(uuid.uuid4()), "source": "ai"})

    est = {
        "estimate_id": str(uuid.uuid4()),
        "user_id": user["user_id"],
        "project_id": body.project_id,
        "client_id": project.get("client_id"),
        "title": f"Kosztorys - {project.get('name', 'inwestycja')}",
        "scope_summary": result["scope_summary"],
        "rooms": result.get("rooms", []),
        "transcription": result.get("transcription", ""),
        "items": items,
        "markup_percent": 10,
        "discount_percent": 0,
        "vat_percent": 23,
        "status": "draft",
        "source": "ai",
        "image_paths": body.image_paths,
        "audio_path": body.audio_path,
        "created_at": now_utc(),
        "updated_at": now_utc(),
        "deleted_at": None,
    }
    await db.estimates.insert_one(est)
    return estimate_out(est)


# ----------------------------- Estimates -----------------------------
@api.get("/estimates")
async def list_estimates(user: dict = Depends(get_current_user)):
    docs = await db.estimates.find({"user_id": user["user_id"], "deleted_at": None}, {"_id": 0}).sort("updated_at", -1).to_list(500)
    projects = {p["project_id"]: p for p in await db.projects.find({"user_id": user["user_id"]}, {"_id": 0}).to_list(1000)}
    clients = {c["client_id"]: c for c in await db.clients.find({"user_id": user["user_id"]}, {"_id": 0}).to_list(1000)}
    out = []
    for e in docs:
        eo = estimate_out(e)
        p = projects.get(e.get("project_id"))
        c = clients.get(e.get("client_id"))
        eo["project_name"] = p["name"] if p else None
        eo["client_name"] = c["name"] if c else None
        out.append(eo)
    return out


@api.post("/estimates")
async def create_estimate(body: EstimateIn, user: dict = Depends(get_current_user)):
    project = await db.projects.find_one({"project_id": body.project_id, "user_id": user["user_id"], "deleted_at": None})
    if not project:
        raise HTTPException(status_code=400, detail="Nieprawidłowa inwestycja")
    items = []
    for it in body.items:
        d = it.model_dump()
        d["item_id"] = d.get("item_id") or str(uuid.uuid4())
        items.append(d)
    est = {
        "estimate_id": str(uuid.uuid4()),
        "user_id": user["user_id"],
        "project_id": body.project_id,
        "client_id": project.get("client_id"),
        "title": body.title or f"Kosztorys - {project.get('name', 'inwestycja')}",
        "scope_summary": body.scope_summary or "",
        "items": items,
        "markup_percent": body.markup_percent,
        "discount_percent": body.discount_percent,
        "vat_percent": body.vat_percent,
        "status": body.status,
        "source": "manual",
        "created_at": now_utc(),
        "updated_at": now_utc(),
        "deleted_at": None,
    }
    await db.estimates.insert_one(est)
    return estimate_out(est)


@api.get("/estimates/{estimate_id}")
async def get_estimate(estimate_id: str, user: dict = Depends(get_current_user)):
    est = await db.estimates.find_one({"estimate_id": estimate_id, "user_id": user["user_id"], "deleted_at": None}, {"_id": 0})
    if not est:
        raise HTTPException(status_code=404, detail="Nie znaleziono kosztorysu")
    out = estimate_out(est)
    out["project"] = await db.projects.find_one({"project_id": est.get("project_id")}, {"_id": 0})
    out["client"] = await db.clients.find_one({"client_id": est.get("client_id")}, {"_id": 0})
    return out


@api.put("/estimates/{estimate_id}")
async def update_estimate(estimate_id: str, body: EstimateUpdateIn, user: dict = Depends(get_current_user)):
    est = await db.estimates.find_one({"estimate_id": estimate_id, "user_id": user["user_id"], "deleted_at": None}, {"_id": 0})
    if not est:
        raise HTTPException(status_code=404, detail="Nie znaleziono kosztorysu")
    updates = {}
    data = body.model_dump(exclude_none=True)
    if "items" in data:
        items = []
        for it in body.items:
            d = it.model_dump()
            d["item_id"] = d.get("item_id") or str(uuid.uuid4())
            items.append(d)
        updates["items"] = items
    for k in ["title", "scope_summary", "markup_percent", "discount_percent", "vat_percent", "status"]:
        if k in data:
            updates[k] = data[k]
    updates["updated_at"] = now_utc()
    await db.estimates.update_one({"estimate_id": estimate_id}, {"$set": updates})
    fresh = await db.estimates.find_one({"estimate_id": estimate_id}, {"_id": 0})
    return estimate_out(fresh)


@api.delete("/estimates/{estimate_id}")
async def delete_estimate(estimate_id: str, user: dict = Depends(get_current_user)):
    await db.estimates.update_one({"estimate_id": estimate_id, "user_id": user["user_id"]}, {"$set": {"deleted_at": now_utc()}})
    return {"ok": True}


@api.get("/estimates/{estimate_id}/pdf")
async def estimate_pdf(estimate_id: str, token: Optional[str] = Query(None), authorization: str = Header(None)):
    bearer = None
    if authorization and authorization.startswith("Bearer "):
        bearer = authorization[7:]
    user = await user_from_token(bearer or token or "")
    if not user:
        raise HTTPException(status_code=401, detail="Brak autoryzacji")
    est = await db.estimates.find_one({"estimate_id": estimate_id, "user_id": user["user_id"], "deleted_at": None}, {"_id": 0})
    if not est:
        raise HTTPException(status_code=404, detail="Nie znaleziono kosztorysu")
    project = await db.projects.find_one({"project_id": est.get("project_id")}, {"_id": 0}) or {}
    client = await db.clients.find_one({"client_id": est.get("client_id")}, {"_id": 0}) or {}
    computed = compute_totals(est)
    pdf_bytes = await run_in_threadpool(pdf_service.build_offer_pdf, est, computed, user, client, project)
    filename = f"oferta_{estimate_id[:8]}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )


@api.get("/")
async def root():
    return {"message": "BudKoszt Pro API"}


app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup():
    try:
        await db.users.create_index("email", unique=True)
        await db.users.create_index("user_id", unique=True)
        await db.user_sessions.create_index("session_token", unique=True)
        await db.user_sessions.create_index("expires_at", expireAfterSeconds=0)
    except Exception as e:
        logger.warning(f"Index creation: {e}")
    try:
        await run_in_threadpool(storage_service.init_storage)
    except Exception as e:
        logger.warning(f"Storage init: {e}")


@app.on_event("shutdown")
async def shutdown():
    pass
