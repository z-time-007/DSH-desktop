/**
 * Zero-dependency DOCX (Word) generator for @local/dsh-office-docs.
 * Produces a minimal but valid macro-free OOXML package from a title,
 * paragraphs, and an optional table — no external links or remote media.
 */

import { writeZip } from './zip.js'
import { xmlEscape } from './xml.js'

const NS_W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

function run(text) {
  return `<w:r><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r>`
}

function paragraph(text, styleId) {
  const pPr = styleId ? `<w:pPr><w:pStyle w:val="${xmlEscape(styleId)}"/></w:pPr>` : ''
  return `<w:p>${pPr}${run(text)}</w:p>`
}

function tableXml(rows) {
  const border = '<w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/>'
    + '<w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/>'
    + '<w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/>'
    + '<w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/>'
    + '<w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/>'
    + '<w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/>'
  const tableRows = rows.map((row) => {
    const cells = row.map((cell) => `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>${paragraph(cell)}</w:tc>`).join('')
    return `<w:tr>${cells}</w:tr>`
  }).join('')
  return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>${border}</w:tblBorders><w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr><w:tblGrid>${rows[0].map(() => '<w:gridCol w:w="2000"/>').join('')}</w:tblGrid>${tableRows}</w:tbl>`
}

function documentXml({ title, paragraphs, table }) {
  const children = []
  if (title) children.push(paragraph(title, 'Title'))
  for (const item of paragraphs) children.push(paragraph(item))
  if (table && table.length > 0) children.push(tableXml(table))
  children.push('<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${NS_W}"><w:body>${children.join('')}</w:body></w:document>`
}

const contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>'

const rootRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>'

const documentRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'

const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="${NS_W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:eastAsia="Microsoft YaHei" w:hAnsi="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="240" w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="48"/><w:szCs w:val="48"/></w:rPr></w:style><w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/><w:unhideWhenUsed/></w:style></w:styles>`

function coreProperties(title) {
  const now = new Date().toISOString()
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEscape(title)}</dc:title><dc:creator>DeepSeek Harness Office Docs</dc:creator><cp:lastModifiedBy>DeepSeek Harness Office Docs</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`
}

const appProperties = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>DeepSeek Harness Office Docs</Application><DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop><Company>Local</Company><LinksUpToDate>false</LinksUpToDate><SharedDoc>false</SharedDoc><HyperlinksChanged>false</HyperlinksChanged><AppVersion>1.0</AppVersion></Properties>'

export function createDocx({ title, paragraphs, table }) {
  const files = {
    '[Content_Types].xml': contentTypes,
    '_rels/.rels': rootRels,
    'word/document.xml': documentXml({ title, paragraphs, table }),
    'word/_rels/document.xml.rels': documentRels,
    'word/styles.xml': styles,
    'docProps/core.xml': coreProperties(title || ''),
    'docProps/app.xml': appProperties,
  }
  return writeZip(files)
}
