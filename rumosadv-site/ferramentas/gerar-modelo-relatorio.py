from pathlib import Path
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "output" / "pdf" / "MODELO_DEFINITIVO_RELATORIO_VIABILIDADE_MARCA.pdf"

DEEP = colors.HexColor("#071B12")
GREEN = colors.HexColor("#315B37")
GOLD = colors.HexColor("#D6B165")
CREAM = colors.HexColor("#F5F1EA")
INK = colors.HexColor("#24352A")
MUTED = colors.HexColor("#667269")
LINE = colors.HexColor("#D9D4CB")
WHITE = colors.white

try:
    pdfmetrics.registerFont(TTFont("RumosSans", r"C:\Windows\Fonts\arial.ttf"))
    pdfmetrics.registerFont(TTFont("RumosSans-Bold", r"C:\Windows\Fonts\arialbd.ttf"))
    FONT_REGULAR = "RumosSans"
    FONT_BOLD = "RumosSans-Bold"
except Exception:
    FONT_REGULAR = "Helvetica"
    FONT_BOLD = "Helvetica-Bold"


class NumberedCanvasMixin:
    pass


def page_decor(canvas, doc):
    canvas.saveState()
    width, height = A4
    canvas.setFillColor(DEEP)
    canvas.rect(0, height - 19 * mm, width, 19 * mm, stroke=0, fill=1)
    canvas.setFillColor(GOLD)
    canvas.setFont(FONT_BOLD, 9)
    canvas.drawString(18 * mm, height - 12 * mm, "RUMOS  |  MARCAS E NEGÓCIOS")
    canvas.setFillColor(MUTED)
    canvas.setFont(FONT_REGULAR, 7.5)
    canvas.drawString(18 * mm, 10 * mm, "Documento confidencial - análise jurídica preliminar")
    canvas.drawRightString(width - 18 * mm, 10 * mm, f"Página {doc.page}")
    canvas.setStrokeColor(GOLD)
    canvas.setLineWidth(0.6)
    canvas.line(18 * mm, 14 * mm, width - 18 * mm, 14 * mm)
    canvas.restoreState()


def styles():
    sample = getSampleStyleSheet()
    return {
        "title": ParagraphStyle(
            "Title",
            parent=sample["Title"],
            fontName=FONT_BOLD,
            fontSize=24,
            leading=28,
            textColor=DEEP,
            alignment=TA_LEFT,
            spaceAfter=8,
        ),
        "eyebrow": ParagraphStyle(
            "Eyebrow",
            parent=sample["Normal"],
            fontName=FONT_BOLD,
            fontSize=8,
            leading=10,
            textColor=GREEN,
            spaceAfter=5,
        ),
        "h2": ParagraphStyle(
            "H2",
            parent=sample["Heading2"],
            fontName=FONT_BOLD,
            fontSize=14,
            leading=17,
            textColor=DEEP,
            spaceBefore=10,
            spaceAfter=7,
        ),
        "h3": ParagraphStyle(
            "H3",
            parent=sample["Heading3"],
            fontName=FONT_BOLD,
            fontSize=10.5,
            leading=13,
            textColor=GREEN,
            spaceBefore=7,
            spaceAfter=4,
        ),
        "body": ParagraphStyle(
            "Body",
            parent=sample["BodyText"],
            fontName=FONT_REGULAR,
            fontSize=9.2,
            leading=13.2,
            textColor=INK,
            spaceAfter=6,
        ),
        "small": ParagraphStyle(
            "Small",
            parent=sample["BodyText"],
            fontName=FONT_REGULAR,
            fontSize=7.6,
            leading=10.5,
            textColor=MUTED,
        ),
        "callout": ParagraphStyle(
            "Callout",
            parent=sample["BodyText"],
            fontName=FONT_BOLD,
            fontSize=10.5,
            leading=14.5,
            textColor=DEEP,
        ),
        "center": ParagraphStyle(
            "Center",
            parent=sample["BodyText"],
            fontName=FONT_BOLD,
            fontSize=9,
            leading=12,
            textColor=WHITE,
            alignment=TA_CENTER,
        ),
    }


def p(text, style):
    return Paragraph(text, style)


def section_title(number, title, s):
    return p(f"{number}. {title}", s["h2"])


def label_value(label, value, s):
    return p(f"<b>{label}</b><br/>{value}", s["body"])


def info_table(rows, widths, s):
    data = [[p(f"<b>{a}</b>", s["small"]), p(b, s["body"])] for a, b in rows]
    table = Table(data, colWidths=widths, hAlign="LEFT")
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (0, -1), CREAM),
                ("GRID", (0, 0), (-1, -1), 0.45, LINE),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 7),
                ("RIGHTPADDING", (0, 0), (-1, -1), 7),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    return table


def data_table(headers, rows, widths, s):
    data = [[p(h, s["small"]) for h in headers]]
    data.extend([[p(str(cell), s["small"]) for cell in row] for row in rows])
    table = Table(data, colWidths=widths, repeatRows=1, hAlign="LEFT")
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), DEEP),
                ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
                ("GRID", (0, 0), (-1, -1), 0.4, LINE),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 5),
                ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, CREAM]),
            ]
        )
    )
    return table


def build_pdf():
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    s = styles()
    doc = SimpleDocTemplate(
        str(OUTPUT),
        pagesize=A4,
        rightMargin=18 * mm,
        leftMargin=18 * mm,
        topMargin=27 * mm,
        bottomMargin=19 * mm,
        title="Modelo definitivo - Análise de viabilidade de marca",
        author="Rumos Advocacia",
        subject="Modelo operacional com dados fictícios",
    )
    story = []
    story.append(p("MODELO DEFINITIVO - DADOS FICTÍCIOS", s["eyebrow"]))
    story.append(p("Análise de Viabilidade<br/>de Registro de Marca", s["title"]))
    story.append(Spacer(1, 3 * mm))
    meta = Table(
        [
            [label_value("Marca analisada", "Montanha Cafés", s), label_value("Caso", "TESTE-0001", s)],
            [label_value("Cliente", "Teste Operacional Rumos", s), label_value("Data de corte", "01/09/2026 - 16h00", s)],
            [label_value("Apresentação", "Nominativa (exemplo)", s), label_value("Responsável", "Dr. Rodrigo Moura Silva - OAB/SP 188.004", s)],
        ],
        colWidths=[87 * mm, 87 * mm],
    )
    meta.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.6, LINE), ("INNERGRID", (0, 0), (-1, -1), 0.4, LINE), ("BACKGROUND", (0, 0), (-1, -1), CREAM), ("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 8), ("RIGHTPADDING", (0, 0), (-1, -1), 8), ("TOPPADDING", (0, 0), (-1, -1), 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 7)]))
    story.append(meta)
    story.append(Spacer(1, 6 * mm))
    badge = Table([[p("FAVORÁVEL COM RESSALVAS", s["center"])]], colWidths=[62 * mm], hAlign="LEFT")
    badge.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), GREEN), ("BOX", (0, 0), (-1, -1), 0.6, DEEP), ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6)]))
    story.append(badge)
    story.append(Spacer(1, 4 * mm))
    summary_box = Table([[p("Neste exemplo fictício, a expressão apresenta elementos evocativos para produtos de café e exige proteção cuidadosamente delimitada. A busca simulada identificou sinal próximo em classe potencialmente afim, mas os dados deste documento não correspondem a uma pesquisa real.", s["callout"]) ]], colWidths=[174 * mm])
    summary_box.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#FBF4E3")), ("BOX", (0, 0), (-1, -1), 1, GOLD), ("LEFTPADDING", (0, 0), (-1, -1), 10), ("RIGHTPADDING", (0, 0), (-1, -1), 10), ("TOPPADDING", (0, 0), (-1, -1), 9), ("BOTTOMPADDING", (0, 0), (-1, -1), 9)]))
    story.append(summary_box)
    story.append(p("Este arquivo demonstra a estrutura e o desenho finais. Antes de qualquer entrega real, todos os campos devem refletir a pesquisa realizada e a revisão pessoal do advogado.", s["small"]))

    story.append(section_title(1, "Conclusão executiva", s))
    story.append(p("A avaliação deve responder, em linguagem clara, quais obstáculos foram encontrados, por que eles importam e qual conduta é recomendada. A faixa de conclusão é qualitativa: não representa probabilidade matemática nem promessa de deferimento.", s["body"]))
    story.append(p("Recomendação do exemplo: avaliar especificação restrita, confirmar a afinidade mercadológica do resultado destacado e, somente depois, decidir sobre o depósito nominativo.", s["body"]))

    story.append(section_title(2, "Informações consideradas", s))
    story.append(info_table([
        ("Produtos/serviços atuais", "Café torrado, café moído e venda online (dado fictício)."),
        ("Expansão planejada", "Cafeteria e produtos promocionais, sujeitos a confirmação."),
        ("Abrangência", "Comercialização pela internet em todo o Brasil."),
        ("Uso e titular", "Uso ainda não comprovado; titular pessoa jurídica em constituição."),
    ], [48 * mm, 126 * mm], s))
    story.append(PageBreak())

    story.append(section_title(3, "Estratégia de proteção", s))
    story.append(data_table(
        ["Prioridade", "Classe", "Escopo sugerido", "Observação"],
        [
            ["Principal", "30", "Café, café torrado e café moído", "Validar termos aceitos pelo INPI"],
            ["Afim examinada", "43", "Serviços de cafeteria", "Pode exigir pedido separado"],
        ],
        [25 * mm, 17 * mm, 78 * mm, 54 * mm],
        s,
    ))
    story.append(p("Modalidade simulada: nominativa. Caso o logotipo tenha relevância autônoma, comparar a conveniência de proteção mista ou figurativa em pedido próprio.", s["body"]))

    story.append(section_title(4, "Metodologia e escopo", s))
    story.append(p("A pesquisa deve registrar expressão exata, aglutinações, separações, singular/plural, elementos dominantes, variações fonéticas, traduções pertinentes, classes principais e afins e elementos figurativos segundo a Classificação de Viena, quando aplicável.", s["body"]))
    story.append(info_table([
        ("Base principal", "Sistema de busca de marcas do INPI."),
        ("Expressões", "MONTANHA CAFÉS; MONTANHACAFÉS; CAFÉS MONTANHA; MONTANHA; variações pertinentes."),
        ("Resultado", "3 registros triados; 1 destacado para análise jurídica (dados fictícios)."),
    ], [48 * mm, 126 * mm], s))

    story.append(section_title(5, "Anterioridades relevantes", s))
    story.append(data_table(
        ["Processo", "Sinal", "Titular", "Situação", "Classe", "Relevância"],
        [["TESTE-0002", "Café da Montanha", "Titular fictício", "Pedido em exame", "30", "Média/alta"]],
        [24 * mm, 34 * mm, 39 * mm, 33 * mm, 17 * mm, 27 * mm],
        s,
    ))
    story.append(p("A tabela principal deve conter apenas resultados capazes de influenciar a conclusão. Cada processo precisa ser confirmado na fonte e analisado em conjunto com sua especificação e situação administrativa.", s["small"]))

    story.append(section_title(6, "Análise de colidência e distintividade", s))
    story.append(p("No exemplo, os sinais compartilham os termos MONTANHA e CAFÉ, ainda que em ordem distinta. A avaliação real deve considerar impressão de conjunto, fonética, significado, elementos dominantes e a proximidade entre os produtos ou serviços. Termos evocativos ou descritivos podem receber proteção mais estreita, sem que isso elimine automaticamente conflitos.", s["body"]))
    story.append(data_table(
        ["Critério", "Avaliação", "Fundamento resumido"],
        [
            ["Identidade", "Não identificada", "Sinais não são literalmente idênticos"],
            ["Semelhança fonética", "Relevante", "Elementos centrais coincidentes"],
            ["Afinidade", "A confirmar", "Escopo de produtos exige leitura integral"],
            ["Distintividade", "Moderada/estreita", "Componentes potencialmente evocativos"],
            ["Risco de oposição", "Não descartado", "Depende de titular, uso e estratégia"],
        ],
        [45 * mm, 35 * mm, 94 * mm],
        s,
    ))
    story.append(PageBreak())

    story.append(section_title(7, "Recomendação prática", s))
    recommendations = [
        "1. Confirmar produtos, serviços e expansão pretendida antes de fechar a especificação.",
        "2. Conferir integralmente o processo destacado e sua situação na data do depósito.",
        "3. Avaliar depósito nominativo com especificação compatível com a estratégia comercial.",
        "4. Se houver logotipo relevante, decidir separadamente sobre proteção mista ou figurativa.",
    ]
    for item in recommendations:
        story.append(p(item, s["body"]))

    story.append(section_title(8, "Limitações da análise", s))
    story.append(p("A pesquisa reflete as bases acessíveis na data e hora de corte. Pedidos ainda não publicados, indisponibilidade da base, alterações posteriores, manifestações de terceiros e o exame do INPI podem modificar o cenário. A análise reduz incertezas, mas não garante concessão, ausência de oposição ou inexistência de conflito.", s["body"]))
    story.append(p("Não estão incluídos neste serviço o protocolo do pedido, retribuições oficiais, acompanhamento administrativo, respostas a exigências, oposições, recursos ou medidas judiciais, salvo contratação expressa em separado.", s["body"]))

    story.append(section_title(9, "Próximos passos", s))
    next_box = Table([[p("Se o cliente desejar prosseguir, a Rumos apresentará proposta separada com titular, modalidade, classes, especificação, honorários, retribuições oficiais e escopo de acompanhamento. Os R$ 390 da análise podem ser abatidos dos honorários do pedido da mesma marca quando a contratação ocorrer em até 30 dias da entrega.", s["body"]) ]], colWidths=[174 * mm])
    next_box.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), CREAM), ("BOX", (0, 0), (-1, -1), 0.8, GREEN), ("LEFTPADDING", (0, 0), (-1, -1), 9), ("RIGHTPADDING", (0, 0), (-1, -1), 9), ("TOPPADDING", (0, 0), (-1, -1), 8), ("BOTTOMPADDING", (0, 0), (-1, -1), 8)]))
    story.append(next_box)
    story.append(Spacer(1, 8 * mm))
    signature = Table(
        [[p("_________________________________________<br/><b>Dr. Rodrigo Moura Silva</b><br/>OAB/SP 188.004<br/>Rumos Advocacia - Campinas/SP", s["body"])]],
        colWidths=[85 * mm],
        hAlign="LEFT",
    )
    story.append(signature)
    story.append(Spacer(1, 5 * mm))
    story.append(p("MODELO COM DADOS FICTÍCIOS - NÃO UTILIZAR PARA ORIENTAR DECISÃO REAL", s["eyebrow"]))

    doc.build(story, onFirstPage=page_decor, onLaterPages=page_decor)
    print(OUTPUT)


if __name__ == "__main__":
    build_pdf()
