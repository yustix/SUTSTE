"""Genera un PDF escaneado de prueba: una página imagen, sin capa de texto.

Sirve para verificar el OCR de SUT STE. Requiere Pillow y reportlab.
Uso: python3 scripts/generar-escaneado.py
"""
import os
import random

from PIL import Image, ImageDraw, ImageFilter, ImageFont
from reportlab.lib.pagesizes import LETTER
from reportlab.pdfgen import canvas

OUT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "muestras"))
os.makedirs(OUT, exist_ok=True)

DPI = 200
W, H = int(8.5 * DPI), int(11 * DPI)
M = int(1.0 * DPI)

FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
FONT_B = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"

LINEAS = [
    ("b", 20, "SINDICATO ÚNICO DE TRABAJADORES"),
    ("n", 14, "Secretaría General - Ciudad de México"),
    ("r", 0, ""),
    ("b", 14, "OFICIO NUM. SG/203/2026"),
    ("n", 14, "ASUNTO: Solicitud de pago de viáticos atrasados"),
    ("n", 14, "FECHA: Ciudad de México, a 10 de septiembre de 2026"),
    ("r", 0, ""),
    ("b", 14, "C. LIC. RAFAEL ANGEL TORRES MENA"),
    ("n", 14, "Director de Finanzas"),
    ("n", 14, "PRESENTE."),
    ("r", 0, ""),
    ("n", 13, "Por medio del presente solicito a usted instruya a quien corresponda el pago"),
    ("n", 13, "de los viáticos pendientes del personal comisionado a las mesas de trabajo"),
    ("n", 13, "celebradas en la ciudad de Toluca durante el mes de agosto de 2026."),
    ("r", 0, ""),
    ("n", 13, "El monto total pendiente asciende a $86,400.00 (ochenta y seis mil cuatrocientos"),
    ("n", 13, "pesos 00/100 M.N.), conforme al desglose que se anexa al presente oficio."),
    ("r", 0, ""),
    ("n", 13, "Se requiere que el pago se realice a más tardar el 30 de septiembre de 2026, a"),
    ("n", 13, "efecto de no afectar a los compañeros comisionados. Agradeceremos nos confirme"),
    ("n", 13, "por escrito la fecha programada del depósito."),
    ("r", 0, ""),
    ("n", 13, "Sin otro particular por el momento, quedo de usted para cualquier aclaración."),
    ("r", 0, ""),
    ("r", 0, ""),
    ("b", 14, "ATENTAMENTE"),
    ("r", 0, ""),
    ("r", 0, ""),
    ("n", 14, "_______________________________"),
    ("b", 13, "ING. JORGE LUIS MENDOZA ARRIAGA"),
    ("n", 13, "Secretario General"),
    ("r", 0, ""),
    ("n", 10, "c.c.p. Archivo. Tesorería. Tel. 55 5555 1234"),
]


def dibujar():
    img = Image.new("L", (W, H), 250)
    d = ImageDraw.Draw(img)
    y = M
    for estilo, tam, texto in LINEAS:
        if estilo == "r":
            y += int(DPI * 0.28)
            continue
        fuente = ImageFont.truetype(FONT_B if estilo == "b" else FONT, int(tam * DPI / 72))
        d.text((M, y), texto, font=fuente, fill=25)
        y += int(tam * DPI / 72 * 1.55)

    # ruido y desenfoque ligero para simular un escaneo real
    img = img.filter(ImageFilter.GaussianBlur(0.55))
    random.seed(7)
    px = img.load()
    for _ in range(int(W * H * 0.012)):
        x, yy = random.randrange(W), random.randrange(H)
        px[x, yy] = max(0, px[x, yy] - random.randrange(28))

    # pequeño giro, como un escaneo torcido
    img = img.rotate(0.35, resample=Image.BICUBIC, fillcolor=245)
    return img


def main():
    img = dibujar()
    png = os.path.join(OUT, "_escaneado-tmp.png")
    img.save(png, "PNG")
    # copia en .tmp para poder probar el OCR sin renderizar el PDF
    img.save(os.path.join(OUT, ".pagina-escaneada.png"), "PNG")

    pdf_path = os.path.join(OUT, "oficio-escaneado-sin-texto.pdf")
    c = canvas.Canvas(pdf_path, pagesize=LETTER)
    c.drawImage(png, 0, 0, width=LETTER[0], height=LETTER[1])
    c.showPage()
    c.save()
    os.remove(png)

    print("generado", pdf_path, f"({os.path.getsize(pdf_path) // 1024} KB, sin capa de texto)")


if __name__ == "__main__":
    main()
