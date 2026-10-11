"""Write data/samples/manual_fbd120.pdf: a short synthetic fluid bed dryer manual for the
"upload a manual" demo. It is not in the seed knowledge base, so uploading it visibly
teaches PlantMemory a new machine (FBD-1).

Usage: uv run python -m scripts.make_sample_manual
"""

from fpdf import FPDF
from fpdf.enums import XPos, YPos

from app.config import ROOT_DIR

OUT = ROOT_DIR / "data" / "samples" / "manual_fbd120.pdf"
TITLE = "Aerodry FBD-120 Fluid Bed Dryer"


class Manual(FPDF):
    def multi_cell(self, *args, **kwargs):
        # Start every block back at the left margin, on the next line.
        kwargs.setdefault("new_x", XPos.LMARGIN)
        kwargs.setdefault("new_y", YPos.NEXT)
        return super().multi_cell(*args, **kwargs)

    def header(self):
        if self.page_no() > 1:
            self.set_font("Helvetica", "", 8)
            self.set_text_color(110)
            self.cell(0, 6, f"{TITLE} - Operation and Maintenance Manual (synthetic sample)")
            self.ln(10)
            self.set_text_color(0)

    def footer(self):
        self.set_y(-12)
        self.set_font("Helvetica", "", 8)
        self.set_text_color(110)
        self.cell(0, 6, f"Page {self.page_no()}", align="C")
        self.set_text_color(0)

    def heading(self, text: str):
        self.set_font("Helvetica", "B", 13)
        self.multi_cell(0, 7, text)
        self.ln(2)

    def para(self, text: str):
        self.set_font("Helvetica", "", 10)
        self.multi_cell(0, 5.2, text)
        self.ln(2)

    def steps(self, items: list[str]):
        self.set_font("Helvetica", "", 10)
        for i, item in enumerate(items, 1):
            self.multi_cell(0, 5.2, f"{i}. {item}")
        self.ln(2)


def draw_dryer(pdf: FPDF, x: float, y: float):
    """Fig. 2.1: product bowl, expansion chamber, filter housing with bags, exhaust fan."""
    pdf.set_line_width(0.5)
    pdf.rect(x + 20, y + 70, 40, 25)  # product bowl
    pdf.line(x + 20, y + 70, x + 15, y + 40)  # expansion chamber (tapered)
    pdf.line(x + 60, y + 70, x + 65, y + 40)
    pdf.rect(x + 10, y + 5, 60, 35)  # filter housing
    for i in range(5):  # filter bags
        bx = x + 16 + i * 11
        pdf.line(bx, y + 8, bx, y + 34)
        pdf.line(bx + 6, y + 8, bx + 6, y + 34)
        pdf.line(bx, y + 34, bx + 6, y + 34)
    pdf.ellipse(x + 85, y + 10, 18, 18)  # exhaust fan
    pdf.line(x + 70, y + 15, x + 85, y + 19)
    pdf.line(x + 20, y + 95, x + 20, y + 102)  # inlet air duct
    pdf.line(x + 60, y + 95, x + 60, y + 102)
    pdf.line(x + 20, y + 102, x + 60, y + 102)
    for i in range(8):  # air distribution plate
        pdf.line(x + 22 + i * 5, y + 92, x + 24 + i * 5, y + 92)
    pdf.set_font("Helvetica", "", 9)
    for label, lx, ly in (
        ("A", 72, 22),
        ("B", 66, 55),
        ("C", 62, 82),
        ("D", 104, 18),
        ("E", 62, 100),
    ):
        pdf.text(x + lx, y + ly, label)


def draw_filter(pdf: FPDF, x: float, y: float):
    """Fig. 5.1: one filter bag on its cage, clamp ring, and the shaker bar."""
    pdf.set_line_width(0.5)
    pdf.rect(x + 30, y + 5, 50, 6)  # shaker bar
    pdf.rect(x + 40, y + 11, 30, 70)  # bag
    for i in range(6):
        pdf.line(x + 40, y + 20 + i * 10, x + 70, y + 20 + i * 10)
    pdf.ellipse(x + 37, y + 78, 36, 8)  # clamp ring
    pdf.line(x + 90, y + 45, x + 72, y + 45)  # arrow to a tear
    pdf.line(x + 72, y + 45, x + 76, y + 42)
    pdf.line(x + 72, y + 45, x + 76, y + 48)
    pdf.line(x + 55, y + 40, x + 60, y + 50)  # tear
    pdf.line(x + 60, y + 50, x + 57, y + 54)


def main() -> None:
    pdf = Manual(format="A4")
    pdf.set_auto_page_break(auto=True, margin=16)
    pdf.set_margins(18, 16, 18)

    pdf.add_page()
    pdf.set_font("Helvetica", "B", 22)
    pdf.ln(60)
    pdf.multi_cell(0, 11, TITLE, align="C")
    pdf.set_font("Helvetica", "", 13)
    pdf.ln(4)
    pdf.multi_cell(
        0, 7, "Operation and Maintenance Manual\nSynthetic sample for PlantMemory", align="C"
    )

    pdf.add_page()
    pdf.heading("1.2 Safety and lockout")
    pdf.para(
        "Fine powder in the dryer can ignite. Keep the machine earthed and never open the "
        "filter housing during a run."
    )
    pdf.steps(
        [
            "Stop the drying cycle and wait until the exhaust fan has stopped.",
            "Switch the main isolator QS1 to OFF, lock it and attach a danger tag.",
            "Close the steam valve to the air heater and the air valve to the bowl seal.",
            "Wait until the product temperature display reads below 40 °C.",
            "Check that the earth clamp is fixed to the product bowl before any work.",
            "Wear a dust mask and gloves as listed in the batch record.",
        ]
    )

    pdf.add_page()
    pdf.heading("2.1 Machine overview")
    pdf.para(
        "Inlet air is heated and passes through the air distribution plate into the product "
        "bowl, where it fluidises the wet granules. The expansion chamber slows the air so "
        "particles fall back. Fines are held by the filter bags in the filter housing; a "
        "shaker bar shakes the bags at a set interval. The exhaust fan pulls the air through."
    )
    y = pdf.get_y() + 4
    draw_dryer(pdf, 40, y)
    pdf.set_y(y + 108)
    pdf.set_font("Helvetica", "I", 9)
    pdf.multi_cell(
        0,
        5,
        "Fig. 2.1 A filter housing with bags, B expansion chamber, C product bowl, "
        "D exhaust fan, E inlet air.",
    )

    pdf.add_page()
    pdf.heading("4.1 Alarm list")
    pdf.para("Alarms starting with E stop the cycle. Alarms starting with W are warnings.")
    rows = [
        ("E-15", "Filter differential pressure high", "Stops", "60 min"),
        ("E-22", "Inlet air temperature high", "Stops", "30 min"),
        ("E-31", "Earth (grounding) fault", "Stops", "15 min"),
        ("E-40", "Bowl seal pressure low", "Stops", "45 min"),
        ("W-08", "Filter differential pressure rising", "Warning", "-"),
        ("W-12", "Product temperature deviation", "Warning", "-"),
    ]
    pdf.set_font("Helvetica", "B", 10)
    for text, w in (("Code", 20), ("Alarm", 90), ("Effect", 30), ("Typical repair", 34)):
        pdf.cell(w, 7, text, border=1)
    pdf.ln()
    pdf.set_font("Helvetica", "", 10)
    for row in rows:
        for text, w in zip(row, (20, 90, 30, 34), strict=True):
            pdf.cell(w, 7, text, border=1)
        pdf.ln()

    pdf.add_page()
    pdf.heading("5.1 E-15 Filter differential pressure high")
    pdf.para(
        "Symptom: alarm E-15, the pressure drop across the filter bags is above 25 mbar and "
        "the cycle stops. Likely causes: bags blinded by fines, shaking interval too long, a "
        "torn bag (fines in the exhaust duct), wet granules."
    )
    pdf.steps(
        [
            "Lock out the dryer (section 1.2).",
            "Open the filter housing and run the shaker manually for 2 minutes.",
            "Inspect every bag for tears and holes, especially near the clamp ring.",
            "Replace torn or blinded bags with filter bag set FBD-FB-120; fit the clamp evenly.",
            "Check the exhaust duct for fines; if found, report to QA before restarting.",
            "Set the shaking interval as per the product's batch record.",
        ]
    )
    pdf.para("Typical time: 60 minutes.")
    y = pdf.get_y() + 2
    draw_filter(pdf, 40, y)
    pdf.set_y(y + 92)
    pdf.set_font("Helvetica", "I", 9)
    pdf.multi_cell(
        0, 5, "Fig. 5.1 Filter bag on the shaker bar. Check for tears near the clamp ring."
    )

    pdf.add_page()
    pdf.heading("5.2 E-40 Bowl seal pressure low")
    pdf.para(
        "Symptom: alarm E-40, the inflatable seal between bowl and expansion chamber does not "
        "reach 3 bar. Likely causes: a cut seal, low compressed air, a leaking air line."
    )
    pdf.steps(
        [
            "Lock out the dryer (section 1.2) and lower the bowl.",
            "Inspect the inflatable seal for cuts and flat spots.",
            "Replace a damaged seal with bowl gasket FBD-GS-04.",
            "Check compressed air supply is at least 5 bar.",
        ]
    )
    pdf.para("Typical time: 45 minutes.")
    pdf.heading("6.1 Return to service")
    pdf.steps(
        [
            "Close the filter housing and remove locks and tags.",
            "Run the fan empty for 5 minutes and check filter pressure drop is below 10 mbar.",
            "QA checks the first granule sample (loss on drying) before the batch continues.",
            "Record the repair and downtime in the equipment logbook.",
        ]
    )

    OUT.parent.mkdir(parents=True, exist_ok=True)
    pdf.output(str(OUT))
    print(f"Wrote {OUT} ({OUT.stat().st_size // 1024} KB, {pdf.page_no()} pages)")


if __name__ == "__main__":
    main()
