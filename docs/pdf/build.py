"""Build the Rolplay end-to-end documentation PDF."""
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from reportlab.platypus import BaseDocTemplate, Frame, PageTemplate

from pdfkit import MARGIN, PAGE, on_page
import part_a
import part_b
import part_c
import part_d

REPO = r'D:\Rolplay_Dashboard_Project'
OUT = os.path.join(REPO, 'docs', 'Rolplay_Dashboard_Documentation.pdf')


def git(*args):
    try:
        return subprocess.run(['git', '-C', REPO, *args], capture_output=True,
                              text=True, timeout=30).stdout.strip()
    except Exception:
        return ''


def main():
    commit = git('rev-parse', '--short', 'HEAD') or 'unknown'
    branch = git('rev-parse', '--abbrev-ref', 'HEAD') or 'unknown'
    date = git('log', '-1', '--format=%cd', '--date=format:%d %B %Y') or 'unknown'

    story = []
    story += part_a.cover(date, '%s @ %s' % (branch, commit))
    story += part_a.contents()
    story += part_a.s1_product()
    story += part_a.s2_architecture()
    story += part_a.s3_tenancy()
    story += part_a.s4_auth()
    story += part_b.s5_pipelines()
    story += part_b.s6_schemas()
    story += part_c.s7_api()
    story += part_c.s8_contracts()
    story += part_c.s9_builder()
    story += part_c.s10_frontend()
    story += part_c.s11_i18n()
    story += part_d.s12_stack()
    story += part_d.s13_deploy()
    story += part_d.s14_issues()

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    doc = BaseDocTemplate(
        OUT, pagesize=PAGE,
        leftMargin=MARGIN, rightMargin=MARGIN,
        topMargin=MARGIN, bottomMargin=MARGIN + 4,
        title='Rolplay Unified Analytics Dashboard -- Engineering Documentation',
        author='Rolplay Engineering',
        subject='End-to-end technical documentation',
    )
    frame = Frame(MARGIN, doc.bottomMargin, doc.width, doc.height, id='body')
    doc.addPageTemplates([PageTemplate(id='main', frames=[frame], onPage=on_page)])
    doc.build(story)

    print('OK  %s  (%.1f KB)' % (OUT, os.path.getsize(OUT) / 1024))


if __name__ == '__main__':
    main()
