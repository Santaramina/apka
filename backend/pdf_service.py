import os

from fpdf import FPDF

FONT_DIR = os.path.join(os.path.dirname(__file__), "fonts")

KIND_LABELS = {"material": "Materiał", "labor": "Robocizna", "extra": "Koszt dodatkowy"}


def _fmt(value: float) -> str:
    s = f"{value:,.2f}"
    s = s.replace(",", " ").replace(".", ",")
    return s


class OfferPDF(FPDF):
    def __init__(self, company_name: str):
        super().__init__(orientation="P", unit="mm", format="A4")
        self._company_name = company_name
        self.add_font("Plex", "", os.path.join(FONT_DIR, "IBMPlexSans-Regular.ttf"))
        self.add_font("Plex", "B", os.path.join(FONT_DIR, "IBMPlexSans-SemiBold.ttf"))
        self.set_auto_page_break(auto=True, margin=18)

    def header(self):
        self.set_font("Plex", "B", 16)
        self.set_text_color(9, 9, 11)
        self.cell(0, 8, self._company_name or "Oferta", new_x="LMARGIN", new_y="NEXT")
        self.set_draw_color(9, 9, 11)
        self.set_line_width(0.6)
        self.line(10, self.get_y() + 1, 200, self.get_y() + 1)
        self.ln(6)

    def footer(self):
        self.set_y(-15)
        self.set_font("Plex", "", 8)
        self.set_text_color(113, 113, 122)
        self.cell(0, 6, "Dokument wygenerowany w aplikacji BudKoszt Pro", align="C")


def build_offer_pdf(estimate: dict, computed: dict, company: dict, client: dict, project: dict) -> bytes:
    pdf = OfferPDF(company.get("company_name") or company.get("name") or "BudKoszt Pro")
    pdf.add_page()

    # Company + client block
    pdf.set_font("Plex", "B", 10)
    pdf.set_text_color(113, 113, 122)
    pdf.cell(95, 5, "WYKONAWCA", new_x="RIGHT", new_y="TOP")
    pdf.cell(95, 5, "KLIENT", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Plex", "", 9)
    pdf.set_text_color(9, 9, 11)

    left = [
        company.get("company_name") or company.get("name") or "",
        f"NIP: {company.get('nip')}" if company.get("nip") else "",
        company.get("address") or "",
        company.get("phone") or "",
        company.get("email") or "",
    ]
    right = [
        client.get("name") or "",
        client.get("company") or "",
        f"NIP: {client.get('nip')}" if client.get("nip") else "",
        client.get("address") or "",
        client.get("phone") or "",
    ]
    left = [x for x in left if x]
    right = [x for x in right if x]
    rows = max(len(left), len(right))
    for i in range(rows):
        l = left[i] if i < len(left) else ""
        r = right[i] if i < len(right) else ""
        pdf.cell(95, 5, l, new_x="RIGHT", new_y="TOP")
        pdf.cell(95, 5, r, new_x="LMARGIN", new_y="NEXT")
    pdf.ln(6)

    # Title
    pdf.set_font("Plex", "B", 13)
    title = estimate.get("title") or "Kosztorys ofertowy"
    pdf.cell(0, 8, title, new_x="LMARGIN", new_y="NEXT")
    if project and project.get("name"):
        pdf.set_font("Plex", "", 9)
        pdf.set_text_color(113, 113, 122)
        pdf.cell(0, 5, f"Inwestycja: {project.get('name')}  {project.get('address') or ''}", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(3)

    if estimate.get("scope_summary"):
        pdf.set_font("Plex", "", 9)
        pdf.set_text_color(9, 9, 11)
        pdf.multi_cell(0, 5, estimate["scope_summary"])
        pdf.ln(2)

    # Table header
    widths = [10, 78, 18, 18, 28, 30]
    headers = ["Lp.", "Pozycja", "Ilość", "Jedn.", "Cena netto", "Wartość netto"]
    pdf.set_font("Plex", "B", 9)
    pdf.set_fill_color(9, 9, 11)
    pdf.set_text_color(255, 255, 255)
    for w, h in zip(widths, headers):
        pdf.cell(w, 8, h, border=0, fill=True, align="C")
    pdf.ln(8)

    pdf.set_text_color(9, 9, 11)
    pdf.set_draw_color(212, 212, 216)
    pdf.set_line_width(0.2)
    items = estimate.get("items", [])
    for idx, it in enumerate(items, start=1):
        line_total = float(it.get("quantity", 0)) * float(it.get("unit_price", 0))
        name = it.get("name", "")
        prefix = ""
        pdf.set_font("Plex", "", 8.5)
        # measure name height
        y0 = pdf.get_y()
        x0 = pdf.get_x()
        pdf.cell(widths[0], 6, str(idx), border="B", align="C")
        # name may wrap
        x_name = pdf.get_x()
        pdf.multi_cell(widths[1], 6, name, border="B")
        y_after = pdf.get_y()
        row_h = y_after - y0
        pdf.set_xy(x_name + widths[1], y0)
        pdf.cell(widths[2], row_h, _fmt(float(it.get("quantity", 0))), border="B", align="R")
        pdf.cell(widths[3], row_h, it.get("unit", ""), border="B", align="C")
        pdf.cell(widths[4], row_h, _fmt(float(it.get("unit_price", 0))), border="B", align="R")
        pdf.cell(widths[5], row_h, _fmt(line_total), border="B", align="R")
        pdf.set_y(y0 + row_h)

    pdf.ln(4)

    # Totals
    def total_row(label, value, bold=False, big=False):
        pdf.set_font("Plex", "B" if bold else "", 12 if big else 9.5)
        pdf.cell(122, 7, "", border=0)
        pdf.cell(38, 7, label, border=0, align="R")
        pdf.cell(30, 7, _fmt(value) + " zł", border=0, align="R")
        pdf.ln(7)

    total_row("Wartość netto:", computed["subtotal"])
    if computed["markup"] > 0:
        total_row(f"Narzut ({estimate.get('markup_percent', 0)}%):", computed["markup"])
    if computed["discount"] > 0:
        total_row(f"Rabat ({estimate.get('discount_percent', 0)}%):", -computed["discount"])
    total_row("Netto:", computed["net"], bold=True)
    total_row(f"VAT ({estimate.get('vat_percent', 23)}%):", computed["vat"])
    pdf.set_draw_color(9, 9, 11)
    pdf.set_line_width(0.5)
    y = pdf.get_y()
    pdf.line(122, y, 200, y)
    pdf.ln(1)
    total_row("DO ZAPŁATY (brutto):", computed["gross"], bold=True, big=True)

    out = pdf.output()
    return bytes(out)
