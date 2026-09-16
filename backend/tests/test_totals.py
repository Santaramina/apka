"""Testy obliczeń kosztorysu: materiały/robocizna/extra, narzut, marża, rabat, VAT,
zysk i cena końcowa. Weryfikacja, że narzut i marża NIE są naliczane podwójnie."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import server  # noqa: E402

ct = server.compute_totals


def _est(items, markup=0, margin=0, discount=0, vat=23):
    return {"items": items, "markup_percent": markup, "margin_percent": margin, "discount_percent": discount, "vat_percent": vat}


def approx(a, b, eps=0.01):
    return abs(a - b) <= eps


# 1. Prosty materiał + robocizna, narzut 10%, VAT 23%
def test_case1_basic_markup_vat():
    t = ct(_est([
        {"kind": "material", "quantity": 100, "unit_price": 4.80},  # YDYp 3x2,5 100mb = 480
        {"kind": "labor", "quantity": 20, "unit_price": 85},        # 20 punktów = 1700
    ], markup=10))
    assert approx(t["materials_cost"], 480)
    assert approx(t["labor_cost"], 1700)
    assert approx(t["subtotal"], 2180)
    assert approx(t["markup"], 218)
    assert approx(t["net"], 2398)
    assert approx(t["vat"], 551.54)
    assert approx(t["gross"], 2949.54)
    assert approx(t["profit"], 218)  # zysk = narzut (bez marży/rabatu)


# 2. Narzut + marża jednocześnie — LICZONE OD SUBTOTAL, nie kaskadowo (brak podwójnego naliczania)
def test_case2_markup_and_margin_not_compounded():
    t = ct(_est([{"kind": "material", "quantity": 1, "unit_price": 1000}], markup=10, margin=15))
    # markup=100, margin=150 (obie od 1000), NIE 10% z (1000+150) itd.
    assert approx(t["markup"], 100)
    assert approx(t["margin"], 150)
    assert approx(t["net"], 1250)          # 1000+100+150
    assert approx(t["profit"], 250)        # net - subtotal
    # sanity: gdyby kaskadowo, byłoby inne (np. 1000*1.1*1.15=1265)
    assert not approx(t["net"], 1265)


# 3. Rabat liczony po narzucie/marży (od before_discount)
def test_case3_discount_after_markup():
    t = ct(_est([{"kind": "labor", "quantity": 10, "unit_price": 100}], markup=20, discount=10))
    # subtotal 1000, markup 200, before_discount 1200, rabat 10% = 120, net 1080
    assert approx(t["markup"], 200)
    assert approx(t["discount"], 120)  # 10% z 1200 (po narzucie), nie z 1000
    assert approx(t["net"], 1080)


# 4. VAT 8% (stawka obniżona) — instalacje w budownictwie mieszkaniowym
def test_case4_vat_8():
    t = ct(_est([{"kind": "material", "quantity": 1, "unit_price": 1000}], vat=8))
    assert approx(t["vat"], 80)
    assert approx(t["gross"], 1080)


# 5. Koszty dodatkowe (extra) wliczane do subtotal
def test_case5_extra_costs():
    t = ct(_est([
        {"kind": "material", "quantity": 1, "unit_price": 200},
        {"kind": "labor", "quantity": 1, "unit_price": 300},
        {"kind": "extra", "quantity": 1, "unit_price": 100},  # np. dojazd
    ]))
    assert approx(t["materials_cost"], 200)
    assert approx(t["labor_cost"], 300)
    assert approx(t["extra_cost"], 100)
    assert approx(t["subtotal"], 600)


# 6. Pełny scenariusz elektryczny: materiały + robocizna + narzut + marża + rabat + VAT
def test_case6_full_electrical():
    t = ct(_est([
        {"kind": "material", "quantity": 150, "unit_price": 4.80},   # 720
        {"kind": "material", "quantity": 30, "unit_price": 14.00},   # gniazda 420
        {"kind": "labor", "quantity": 30, "unit_price": 85},         # punkty 2550
        {"kind": "labor", "quantity": 1, "unit_price": 350},         # rozdzielnica 350
    ], markup=10, margin=5, discount=5, vat=23))
    subtotal = 720 + 420 + 2550 + 350
    assert approx(t["subtotal"], subtotal)  # 4040
    markup = subtotal * 0.10
    margin = subtotal * 0.05
    before = subtotal + markup + margin
    discount = before * 0.05
    net = before - discount
    vat = net * 0.23
    assert approx(t["markup"], markup)
    assert approx(t["margin"], margin)
    assert approx(t["discount"], discount)
    assert approx(t["net"], net)
    assert approx(t["vat"], vat)
    assert approx(t["gross"], net + vat)
    assert approx(t["profit"], net - subtotal)


# 7. Zero pozycji -> wszystko 0
def test_case7_empty():
    t = ct(_est([]))
    for k in ("subtotal", "net", "vat", "gross", "profit"):
        assert approx(t[k], 0)


# 8. Zysk uwzględnia marżę i narzut, ale rabat go obniża
def test_case8_profit_with_discount():
    t = ct(_est([{"kind": "material", "quantity": 1, "unit_price": 1000}], markup=10, margin=10, discount=10))
    # subtotal 1000, markup 100, margin 100, before 1200, discount 120, net 1080, profit 80
    assert approx(t["net"], 1080)
    assert approx(t["profit"], 80)


# 9. Ilości ułamkowe (m2 płytek) i zaokrąglenia
def test_case9_fractional_quantities():
    t = ct(_est([
        {"kind": "material", "quantity": 12.5, "unit_price": 65},   # 812.5
        {"kind": "labor", "quantity": 12.5, "unit_price": 90},      # 1125
    ], vat=23))
    assert approx(t["subtotal"], 1937.5)
    assert approx(t["vat"], 1937.5 * 0.23)


# 10. Sam rabat bez narzutu/marży
def test_case10_only_discount():
    t = ct(_est([{"kind": "labor", "quantity": 1, "unit_price": 1000}], discount=15))
    assert approx(t["discount"], 150)
    assert approx(t["net"], 850)
    assert approx(t["profit"], -150)  # rabat bez narzutu -> ujemny zysk względem kosztu


# 11. VAT 0% (np. eksport / odwrotne obciążenie)
def test_case11_vat_zero():
    t = ct(_est([{"kind": "material", "quantity": 1, "unit_price": 500}], vat=0))
    assert approx(t["vat"], 0)
    assert approx(t["gross"], t["net"])


# 12. Duży kosztorys elektryczny (mieszanka) — spójność gross = net + vat, net = before - discount
def test_case12_consistency_invariants():
    items = [
        {"kind": "material", "quantity": 200, "unit_price": 3.20},
        {"kind": "material", "quantity": 500, "unit_price": 1.10},
        {"kind": "labor", "quantity": 45, "unit_price": 85},
        {"kind": "labor", "quantity": 2, "unit_price": 250},
        {"kind": "extra", "quantity": 1, "unit_price": 300},
    ]
    t = ct(_est(items, markup=12, margin=8, discount=3, vat=23))
    before = t["subtotal"] + t["markup"] + t["margin"]
    assert approx(t["net"], before - t["discount"])
    assert approx(t["gross"], t["net"] + t["vat"])
    assert approx(t["profit"], t["net"] - t["subtotal"])
    # narzut i marża liczone od subtotal (nie kaskadowo)
    assert approx(t["markup"], t["subtotal"] * 0.12)
    assert approx(t["margin"], t["subtotal"] * 0.08)
