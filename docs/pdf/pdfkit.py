"""Shared Platypus helpers for the Rolplay end-to-end documentation PDF.

ASCII-only text: the built-in Helvetica fonts use WinAnsi encoding, so arrows,
checkmarks and set operators would render as solid black boxes.
"""
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    HRFlowable, KeepTogether, PageBreak, Paragraph, Preformatted, Spacer, Table,
    TableStyle,
)

RED = colors.HexColor('#DC2626')
INK = colors.HexColor('#1F2937')
TEAL = colors.HexColor('#0F766E')
MUTED = colors.HexColor('#6B7280')
RULE = colors.HexColor('#E5E7EB')
ZEBRA = colors.HexColor('#F9FAFB')
CODEBG = colors.HexColor('#F3F4F6')

PAGE = A4
MARGIN = 16 * mm
CONTENT_W = PAGE[0] - 2 * MARGIN

_ss = getSampleStyleSheet()

S = {
    'h1': ParagraphStyle('h1', parent=_ss['Heading1'], fontName='Helvetica-Bold',
                         fontSize=19, leading=23, textColor=RED,
                         spaceBefore=0, spaceAfter=3),
    'h2': ParagraphStyle('h2', parent=_ss['Heading2'], fontName='Helvetica-Bold',
                         fontSize=12.5, leading=16, textColor=INK,
                         spaceBefore=13, spaceAfter=4),
    'h3': ParagraphStyle('h3', parent=_ss['Heading3'], fontName='Helvetica-Bold',
                         fontSize=10.2, leading=13.5, textColor=TEAL,
                         spaceBefore=9, spaceAfter=3),
    'p': ParagraphStyle('p', parent=_ss['BodyText'], fontName='Helvetica',
                        fontSize=9.1, leading=13.2, textColor=INK,
                        spaceBefore=0, spaceAfter=6),
    'li': ParagraphStyle('li', parent=_ss['BodyText'], fontName='Helvetica',
                         fontSize=9.1, leading=13.0, textColor=INK,
                         leftIndent=11, bulletIndent=2, spaceAfter=2.5),
    'th': ParagraphStyle('th', fontName='Helvetica-Bold', fontSize=7.9,
                         leading=10.2, textColor=colors.white),
    'td': ParagraphStyle('td', fontName='Helvetica', fontSize=7.9,
                         leading=10.2, textColor=INK),
    'tdm': ParagraphStyle('tdm', fontName='Courier', fontSize=7.4,
                          leading=10.0, textColor=INK),
    'note': ParagraphStyle('note', fontName='Helvetica', fontSize=8.5,
                           leading=12.0, textColor=INK,
                           leftIndent=7, rightIndent=6,
                           spaceBefore=3, spaceAfter=7),
    'cap': ParagraphStyle('cap', fontName='Helvetica-Oblique', fontSize=8.0,
                          leading=11, textColor=MUTED, spaceAfter=8),
    'code': ParagraphStyle('code', fontName='Courier', fontSize=7.4,
                           leading=9.8, textColor=INK),
}


# Entities the content authors intentionally, which escape() would turn into
# literal text ("&mdash;" instead of an em dash). Restored after escaping.
_ENTITIES = {
    '&amp;mdash;': '—',
    '&amp;ndash;': '–',
    '&amp;lt;': '&lt;',
    '&amp;gt;': '&gt;',
    '&amp;amp;': '&amp;',
    '&amp;nbsp;': '&nbsp;',
}


def _rich(t):
    """Escape XML, then re-enable `backticks` as inline monospace and **bold**."""
    out = escape(str(t))
    for literal, intended in _ENTITIES.items():
        out = out.replace(literal, intended)
    while '**' in out:
        a = out.find('**')
        b = out.find('**', a + 2)
        if b == -1:
            break
        out = out[:a] + '<b>' + out[a + 2:b] + '</b>' + out[b + 2:]
    parts = out.split('`')
    for i in range(1, len(parts), 2):
        parts[i] = ('<font face="Courier" size="8">%s</font>' % parts[i])
    return ''.join(parts)


def H1(t, anchor=None):
    tag = '<a name="%s"/>' % anchor if anchor else ''
    return [Paragraph(tag + _rich(t), S['h1']),
            HRFlowable(width='100%', thickness=1.1, color=RED,
                       spaceBefore=3, spaceAfter=9)]


def H2(t):
    return Paragraph(_rich(t), S['h2'])


def H3(t):
    return Paragraph(_rich(t), S['h3'])


def P(t):
    return Paragraph(_rich(t), S['p'])


def BULLETS(items):
    return [Paragraph(_rich(i), S['li'], bulletText='•') for i in items]


def NUMBERED(items):
    return [Paragraph(_rich(t), S['li'], bulletText='%d.' % n)
            for n, t in enumerate(items, 1)]


def CAP(t):
    return Paragraph(_rich(t), S['cap'])


def NOTE(t, accent=TEAL, label=None):
    body = ('<b>%s</b>  ' % escape(label) if label else '') + _rich(t)
    inner = Paragraph(body, S['note'])
    tbl = Table([[inner]], colWidths=[CONTENT_W])
    tbl.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor('#F8FAFC')),
        ('LINEBEFORE', (0, 0), (0, -1), 2.4, accent),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ('LEFTPADDING', (0, 0), (-1, -1), 7),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
    ]))
    return [tbl, Spacer(1, 7)]


def CODE(text, title=None):
    """Fixed-width block. Long lines are the caller's problem -- keep them short."""
    flow = []
    if title:
        flow.append(Paragraph('<b>%s</b>' % escape(title), S['cap']))
    body = Preformatted(text.strip('\n'), S['code'])
    tbl = Table([[body]], colWidths=[CONTENT_W])
    tbl.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), CODEBG),
        ('BOX', (0, 0), (-1, -1), 0.5, RULE),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ('LEFTPADDING', (0, 0), (-1, -1), 7),
    ]))
    flow += [tbl, Spacer(1, 8)]
    return flow


def TABLE(header, rows, widths, mono_cols=(), font_size=None):
    """widths = list of relative weights, scaled to the content width."""
    total = float(sum(widths))
    cw = [CONTENT_W * w / total for w in widths]

    th, td, tdm = S['th'], S['td'], S['tdm']
    if font_size:
        th = ParagraphStyle('th2', parent=th, fontSize=font_size, leading=font_size + 2.3)
        td = ParagraphStyle('td2', parent=td, fontSize=font_size, leading=font_size + 2.3)
        tdm = ParagraphStyle('tdm2', parent=tdm, fontSize=font_size - 0.4, leading=font_size + 2.1)

    data = [[Paragraph(_rich(c), th) for c in header]]
    for r in rows:
        data.append([Paragraph(_rich(c), tdm if i in mono_cols else td)
                     for i, c in enumerate(r)])

    t = Table(data, colWidths=cw, repeatRows=1, hAlign='LEFT')
    style = [
        ('BACKGROUND', (0, 0), (-1, 0), INK),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('GRID', (0, 0), (-1, -1), 0.4, RULE),
        ('TOPPADDING', (0, 0), (-1, -1), 3.4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3.4),
        ('LEFTPADDING', (0, 0), (-1, -1), 4.5),
        ('RIGHTPADDING', (0, 0), (-1, -1), 4.5),
    ]
    for i in range(2, len(data), 2):
        style.append(('BACKGROUND', (0, i), (-1, i), ZEBRA))
    t.setStyle(TableStyle(style))
    return [t, Spacer(1, 9)]


def KV(pairs, widths=(30, 70)):
    """Two-column definition table with no header row."""
    total = float(sum(widths))
    cw = [CONTENT_W * w / total for w in widths]
    data = [[Paragraph('<b>%s</b>' % _rich(k), S['td']),
             Paragraph(_rich(v), S['td'])] for k, v in pairs]
    t = Table(data, colWidths=cw, hAlign='LEFT')
    t.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('GRID', (0, 0), (-1, -1), 0.4, RULE),
        ('BACKGROUND', (0, 0), (0, -1), ZEBRA),
        ('TOPPADDING', (0, 0), (-1, -1), 3.4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3.4),
        ('LEFTPADDING', (0, 0), (-1, -1), 4.5),
    ]))
    return [t, Spacer(1, 9)]


def on_page(canv, doc):
    """Footer: rule, doc label, page number. Suppressed on the cover."""
    canv.saveState()
    if doc.page > 1:
        y = MARGIN - 5 * mm
        canv.setStrokeColor(RULE)
        canv.setLineWidth(0.5)
        canv.line(MARGIN, y + 4 * mm, PAGE[0] - MARGIN, y + 4 * mm)
        canv.setFont('Helvetica', 7.6)
        canv.setFillColor(MUTED)
        canv.drawString(MARGIN, y, 'Rolplay Unified Dashboard — Engineering Documentation')
        canv.drawRightString(PAGE[0] - MARGIN, y, 'Page %d' % doc.page)
    canv.restoreState()
