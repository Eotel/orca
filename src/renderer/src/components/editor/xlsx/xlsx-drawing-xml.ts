const DRAWING_NAMESPACE_PREFIXES = new Map([
  ['http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing', 'xdr'],
  ['http://schemas.openxmlformats.org/drawingml/2006/chart', 'c'],
  ['http://schemas.openxmlformats.org/drawingml/2006/main', 'a'],
  ['http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'r']
])
const XMLNS_NAMESPACE = 'http://www.w3.org/2000/xmlns/'

// Resolve namespaces once at the drawing/chart boundary before the lightweight readers run.
export function normalizeXlsxDrawingXml(xml: string): string {
  if (xml.trim() === '') {
    return ''
  }
  const document = new DOMParser().parseFromString(xml, 'application/xml')
  return document.documentElement ? serializeElement(document.documentElement) : ''
}

function elementName(element: Element): string {
  const prefix = DRAWING_NAMESPACE_PREFIXES.get(element.namespaceURI ?? '') ?? 'foreign'
  return `${prefix}:${element.localName}`
}

function escapeXml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;')
}

function serializeElement(element: Element): string {
  const attributes = Array.from(element.attributes)
    .filter((attribute) => attribute.namespaceURI !== XMLNS_NAMESPACE)
    .map((attribute) => {
      const prefix = attribute.namespaceURI
        ? `${DRAWING_NAMESPACE_PREFIXES.get(attribute.namespaceURI) ?? 'foreign'}:`
        : ''
      return ` ${prefix}${attribute.localName}="${escapeXml(attribute.value)}"`
    })
    .join('')
  const inner = Array.from(element.childNodes)
    .map((child) =>
      child instanceof Element ? serializeElement(child) : escapeXml(child.textContent ?? '')
    )
    .join('')
  const name = elementName(element)
  return `<${name}${attributes}>${inner}</${name}>`
}
