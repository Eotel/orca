Synthetic workbook fixtures contain no customer data.

- `preview.xlsx`: openpyxl 3.1.5 output, including default drawing/chart namespaces, one-cell anchors, and chart references without caches.
- `preview-libreoffice.xlsx`: the same workbook saved by LibreOffice 26.8.1.1, with cached charts and two-cell anchors.
- `preview-excel-style.xlsx`: synthetic conventional Excel XML, with explicit DrawingML prefixes, two-cell anchors, and cached chart values. This file was not produced by Microsoft Excel.

The workbook contains Japanese text, merged cells, fills, borders, currency/date formats, an image, a column chart, and two sheets. Formula evaluation is outside the preview's scope; only stored cell results and supported chart references are read.
