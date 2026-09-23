import AdmZip from "adm-zip";

interface FixtureSection {
  id: string;
  href: string;
  body: string;
}

interface FixtureTocNode {
  label: string;
  href: string;
  children?: FixtureTocNode[];
}

interface FixtureInput {
  sections: FixtureSection[];
  nav?: FixtureTocNode[];
  ncx?: FixtureTocNode[];
}

export interface InspectorEpubFixture {
  id: string;
  description: string;
  epub: Buffer;
  expected: {
    tocQuality: "declared" | "declared_repaired" | "spine_fallback";
    sectionCount: number;
    nodeCount: number;
    labels?: string[];
    warningCodes?: string[];
    parentLabels?: Array<string | null>;
    levels?: number[];
    paths?: string[];
    sourceHeadingLevels?: Array<number | null>;
    provenance?: {
      source: "ncx" | "epub_nav" | "spine_fallback";
      positionStrategy: "declared" | "repaired" | "spine_fallback";
      hierarchyStrategy: "declared" | "inferred_headings" | "flat" | "spine_fallback";
      headingMappedNodeCount: number;
      inferredParentCount: number;
    };
  };
}

const repeated = "论证正文".repeat(12_600);
const manyFlatHeadings = Array.from({ length: 201 }, (_, index) => (
  `<h2 id="n${index}">节点 ${index + 1}</h2><p>正文 ${index + 1}。</p>`
)).join("");
const manyFlatNodes = Array.from({ length: 201 }, (_, index) => ({
  label: `节点 ${index + 1}`,
  href: `many.xhtml#n${index}`,
}));

export const inspectorEpubFixtures: InspectorEpubFixture[] = [
  fixture("single-section", "单 XHTML 单章", {
    sections: [{ id: "s1", href: "chapter.xhtml", body: '<h1 id="chapter">第一章</h1><p>前提。</p><p>结论。</p>' }],
    nav: [{ label: "第一章", href: "chapter.xhtml#chapter" }],
  }, { tocQuality: "declared", sectionCount: 1, nodeCount: 1, labels: ["第一章"] }),

  fixture("fragment-sections", "同 XHTML 多 fragment 小节", {
    sections: [{
      id: "s1",
      href: "chapter.xhtml",
      body: '<h1 id="chapter">第一章</h1><p>引言。</p><h2 id="premise">前提</h2><p>甲。</p><h2 id="conclusion">结论</h2><p>乙。</p>',
    }],
    nav: [
      { label: "第一章", href: "chapter.xhtml#chapter" },
      { label: "前提", href: "chapter.xhtml#premise" },
      { label: "结论", href: "chapter.xhtml#conclusion" },
    ],
  }, {
    tocQuality: "declared_repaired",
    sectionCount: 1,
    nodeCount: 3,
    labels: ["第一章", "前提", "结论"],
    parentLabels: [null, "第一章", "第一章"],
    levels: [1, 2, 2],
    paths: ["第一章", "第一章 > 前提", "第一章 > 结论"],
    sourceHeadingLevels: [1, 2, 2],
    provenance: {
      source: "epub_nav",
      positionStrategy: "declared",
      hierarchyStrategy: "inferred_headings",
      headingMappedNodeCount: 3,
      inferredParentCount: 2,
    },
  }),

  fixture("flat-unlabelled-headings", "无编号扁平目录按 h1-h4 建树", {
    sections: [{
      id: "s1",
      href: "argument.xhtml",
      body: '<h1 id="foundation">基础</h1><p>甲。</p><h2 id="premise">前提</h2><p>乙。</p><h3 id="detail">细节</h3><p>丙。</p><h4 id="note">注记</h4><p>丁。</p><h2 id="result">结论</h2><p>戊。</p>',
    }],
    ncx: [
      { label: "基础", href: "argument.xhtml#foundation" },
      { label: "前提", href: "argument.xhtml#premise" },
      { label: "细节", href: "argument.xhtml#detail" },
      { label: "注记", href: "argument.xhtml#note" },
      { label: "结论", href: "argument.xhtml#result" },
    ],
  }, {
    tocQuality: "declared_repaired",
    sectionCount: 1,
    nodeCount: 5,
    labels: ["基础", "前提", "细节", "注记", "结论"],
    parentLabels: [null, "基础", "前提", "细节", "基础"],
    levels: [1, 2, 3, 4, 2],
    paths: ["基础", "基础 > 前提", "基础 > 前提 > 细节", "基础 > 前提 > 细节 > 注记", "基础 > 结论"],
    sourceHeadingLevels: [1, 2, 3, 4, 2],
    provenance: {
      source: "ncx",
      positionStrategy: "declared",
      hierarchyStrategy: "inferred_headings",
      headingMappedNodeCount: 5,
      inferredParentCount: 4,
    },
  }),

  fixture("heading-descendant-fragment", "fragment 位于标题内部时继承标题级别", {
    sections: [{
      id: "s1",
      href: "descendant.xhtml",
      body: '<h1><span id="root-label">根标题</span></h1><p>甲。</p><h2><em id="child-label">子标题</em></h2><p>乙。</p>',
    }],
    nav: [
      { label: "根标题", href: "descendant.xhtml#root-label" },
      { label: "子标题", href: "descendant.xhtml#child-label" },
    ],
  }, {
    tocQuality: "declared_repaired",
    sectionCount: 1,
    nodeCount: 2,
    labels: ["根标题", "子标题"],
    parentLabels: [null, "根标题"],
    levels: [1, 2],
    sourceHeadingLevels: [1, 2],
    provenance: {
      source: "epub_nav",
      positionStrategy: "declared",
      hierarchyStrategy: "inferred_headings",
      headingMappedNodeCount: 2,
      inferredParentCount: 1,
    },
  }),

  fixture("declared-nesting-wins", "原生嵌套优先于正文标题级别", {
    sections: [{
      id: "s1",
      href: "declared.xhtml",
      body: '<h3 id="parent">声明父节点</h3><p>甲。</p><h1 id="child">声明子节点</h1><p>乙。</p>',
    }],
    nav: [{
      label: "声明父节点",
      href: "declared.xhtml#parent",
      children: [{ label: "声明子节点", href: "declared.xhtml#child" }],
    }],
  }, {
    tocQuality: "declared",
    sectionCount: 1,
    nodeCount: 2,
    labels: ["声明父节点", "声明子节点"],
    parentLabels: [null, "声明父节点"],
    levels: [1, 2],
    sourceHeadingLevels: [3, 1],
    provenance: {
      source: "epub_nav",
      positionStrategy: "declared",
      hierarchyStrategy: "declared",
      headingMappedNodeCount: 2,
      inferredParentCount: 0,
    },
  }),

  fixture("same-level-headings", "同级正文标题保持扁平", {
    sections: [{
      id: "s1",
      href: "peers.xhtml",
      body: '<h2 id="a">甲</h2><p>甲文。</p><h2 id="b">乙</h2><p>乙文。</p><h2 id="c">丙</h2><p>丙文。</p>',
    }],
    nav: [
      { label: "甲", href: "peers.xhtml#a" },
      { label: "乙", href: "peers.xhtml#b" },
      { label: "丙", href: "peers.xhtml#c" },
    ],
  }, {
    tocQuality: "declared",
    sectionCount: 1,
    nodeCount: 3,
    labels: ["甲", "乙", "丙"],
    parentLabels: [null, null, null],
    levels: [1, 1, 1],
    sourceHeadingLevels: [2, 2, 2],
    provenance: {
      source: "epub_nav",
      positionStrategy: "declared",
      hierarchyStrategy: "flat",
      headingMappedNodeCount: 3,
      inferredParentCount: 0,
    },
  }),

  fixture("unmapped-clears-stack", "无法映射标题时清空推断栈", {
    sections: [{
      id: "s1",
      href: "uncertain.xhtml",
      body: '<h1 id="root">根标题</h1><p>甲。</p><p id="uncertain">不确定边界</p><h2 id="tail">后续小节</h2><p>乙。</p>',
    }],
    nav: [
      { label: "根标题", href: "uncertain.xhtml#root" },
      { label: "不确定边界", href: "uncertain.xhtml#uncertain" },
      { label: "后续小节", href: "uncertain.xhtml#tail" },
    ],
  }, {
    tocQuality: "declared",
    sectionCount: 1,
    nodeCount: 3,
    labels: ["根标题", "不确定边界", "后续小节"],
    parentLabels: [null, null, null],
    levels: [1, 1, 1],
    sourceHeadingLevels: [1, null, 2],
    provenance: {
      source: "epub_nav",
      positionStrategy: "declared",
      hierarchyStrategy: "flat",
      headingMappedNodeCount: 2,
      inferredParentCount: 0,
    },
  }),

  fixture("duplicate-heading-label", "无 fragment 的重复标题不映射", {
    sections: [
      { id: "s1", href: "duplicate-label.xhtml", body: "<h1>重复</h1><p>甲。</p><h2>重复</h2><p>乙。</p>" },
      { id: "s2", href: "unique.xhtml", body: "<h2>唯一</h2><p>丙。</p>" },
    ],
    nav: [
      { label: "重复", href: "duplicate-label.xhtml" },
      { label: "唯一", href: "unique.xhtml" },
    ],
  }, {
    tocQuality: "declared",
    sectionCount: 2,
    nodeCount: 2,
    labels: ["重复", "唯一"],
    parentLabels: [null, null],
    levels: [1, 1],
    sourceHeadingLevels: [null, 2],
    provenance: {
      source: "epub_nav",
      positionStrategy: "declared",
      hierarchyStrategy: "flat",
      headingMappedNodeCount: 1,
      inferredParentCount: 0,
    },
  }),

  fixture("cross-xhtml-headings", "跨 XHTML 标题级别仍可建树", {
    sections: [
      { id: "s1", href: "part.xhtml", body: '<h1 id="part">卷</h1><p>引言。</p>' },
      { id: "s2", href: "chapter.xhtml", body: '<h2 id="chapter">章</h2><p>正文。</p>' },
    ],
    ncx: [
      { label: "卷", href: "part.xhtml#part" },
      { label: "章", href: "chapter.xhtml#chapter" },
    ],
  }, {
    tocQuality: "declared_repaired",
    sectionCount: 2,
    nodeCount: 2,
    labels: ["卷", "章"],
    parentLabels: [null, "卷"],
    levels: [1, 2],
    sourceHeadingLevels: [1, 2],
    provenance: {
      source: "ncx",
      positionStrategy: "declared",
      hierarchyStrategy: "inferred_headings",
      headingMappedNodeCount: 2,
      inferredParentCount: 1,
    },
  }),

  fixture("heading-level-jump", "标题级别跳跃按最近较低级父节点建树", {
    sections: [{
      id: "s1",
      href: "jump.xhtml",
      body: '<h1 id="root">根</h1><p>甲。</p><h3 id="deep">三级</h3><p>乙。</p><h2 id="middle">二级</h2><p>丙。</p>',
    }],
    nav: [
      { label: "根", href: "jump.xhtml#root" },
      { label: "三级", href: "jump.xhtml#deep" },
      { label: "二级", href: "jump.xhtml#middle" },
    ],
  }, {
    tocQuality: "declared_repaired",
    sectionCount: 1,
    nodeCount: 3,
    labels: ["根", "三级", "二级"],
    parentLabels: [null, "根", "根"],
    levels: [1, 2, 2],
    sourceHeadingLevels: [1, 3, 2],
    provenance: {
      source: "epub_nav",
      positionStrategy: "declared",
      hierarchyStrategy: "inferred_headings",
      headingMappedNodeCount: 3,
      inferredParentCount: 2,
    },
  }),

  fixture("read-boundary-tree", "推断父子树提供跨 section 的直读边界", {
    sections: [
      { id: "s1", href: "part.xhtml", body: `<h1 id="part">第一部</h1><p>${"部引言".repeat(80)}</p>` },
      { id: "s2", href: "chapter-one.xhtml", body: `<h2 id="chapter-one">第一章</h2><p>${"第一章正文".repeat(120)}</p>` },
      { id: "s3", href: "section-one.xhtml", body: `<h3 id="section-one">第一节</h3><p>${"第一节正文".repeat(120)}</p>` },
      { id: "s4", href: "chapter-two.xhtml", body: `<h2 id="chapter-two">第二章</h2><p>${"第二章正文".repeat(80)}</p>` },
      { id: "s5", href: "part-two.xhtml", body: `<h1 id="part-two">第二部</h1><p>${"第二部正文".repeat(80)}</p>` },
    ],
    ncx: [
      { label: "第一部", href: "part.xhtml#part" },
      { label: "第一章", href: "chapter-one.xhtml#chapter-one" },
      { label: "第一节", href: "section-one.xhtml#section-one" },
      { label: "第二章", href: "chapter-two.xhtml#chapter-two" },
      { label: "第二部", href: "part-two.xhtml#part-two" },
    ],
  }, {
    tocQuality: "declared_repaired",
    sectionCount: 5,
    nodeCount: 5,
    labels: ["第一部", "第一章", "第一节", "第二章", "第二部"],
    parentLabels: [null, "第一部", "第一章", "第一部", null],
    levels: [1, 2, 3, 2, 1],
    provenance: {
      source: "ncx",
      positionStrategy: "declared",
      hierarchyStrategy: "inferred_headings",
      headingMappedNodeCount: 5,
      inferredParentCount: 3,
    },
  }),

  fixture("numbering-without-headings", "编号清晰但正文无标题级别时保持扁平", {
    sections: [{
      id: "s1",
      href: "numbered.xhtml",
      body: '<p id="one">1 主题</p><p>甲。</p><p id="one-one">1.1 子题</p><p>乙。</p>',
    }],
    nav: [
      { label: "1 主题", href: "numbered.xhtml#one" },
      { label: "1.1 子题", href: "numbered.xhtml#one-one" },
    ],
  }, {
    tocQuality: "declared",
    sectionCount: 1,
    nodeCount: 2,
    labels: ["1 主题", "1.1 子题"],
    parentLabels: [null, null],
    levels: [1, 1],
    sourceHeadingLevels: [null, null],
    provenance: {
      source: "epub_nav",
      positionStrategy: "declared",
      hierarchyStrategy: "flat",
      headingMappedNodeCount: 0,
      inferredParentCount: 0,
    },
  }),

  fixture("tree-limit", "201 节点用于生产 tree 上限与 Inspector bypass", {
    sections: [{ id: "s1", href: "many.xhtml", body: manyFlatHeadings }],
    nav: manyFlatNodes,
  }, {
    tocQuality: "declared",
    sectionCount: 1,
    nodeCount: 201,
    levels: Array.from({ length: 201 }, () => 1),
    provenance: {
      source: "epub_nav",
      positionStrategy: "declared",
      hierarchyStrategy: "flat",
      headingMappedNodeCount: 201,
      inferredParentCount: 0,
    },
  }),

  fixture("spanning-node", "node 跨多个 spine XHTML", {
    sections: [
      { id: "s1", href: "one.xhtml", body: "<h1>第一章</h1><p>第一段。</p>" },
      { id: "s2", href: "two.xhtml", body: "<p>第二段。</p>" },
      { id: "s3", href: "three.xhtml", body: "<h1>第二章</h1><p>第三段。</p>" },
    ],
    nav: [
      { label: "第一章", href: "one.xhtml" },
      { label: "第二章", href: "three.xhtml" },
    ],
  }, { tocQuality: "declared", sectionCount: 3, nodeCount: 2, labels: ["第一章", "第二章"] }),

  fixture("parent-intro", "父 node 自有引言加子 node", {
    sections: [{
      id: "s1",
      href: "nested.xhtml",
      body: '<h1 id="parent">主题</h1><p>父级引言。</p><h2 id="child">子论点</h2><p>子级正文。</p>',
    }],
    nav: [{ label: "主题", href: "nested.xhtml#parent", children: [{ label: "子论点", href: "nested.xhtml#child" }] }],
  }, { tocQuality: "declared", sectionCount: 1, nodeCount: 2, labels: ["主题", "子论点"] }),

  fixture("deep-toc", "多级嵌套目录", {
    sections: [{
      id: "s1",
      href: "deep.xhtml",
      body: '<h1 id="l1">一级</h1><p>甲。</p><h2 id="l2">二级</h2><p>乙。</p><h3 id="l3">三级</h3><p>丙。</p>',
    }],
    nav: [{
      label: "一级",
      href: "deep.xhtml#l1",
      children: [{ label: "二级", href: "deep.xhtml#l2", children: [{ label: "三级", href: "deep.xhtml#l3" }] }],
    }],
  }, { tocQuality: "declared", sectionCount: 1, nodeCount: 3, labels: ["一级", "二级", "三级"] }),

  fixture("duplicate-fragment", "重复 fragment", {
    sections: [{ id: "s1", href: "duplicate.xhtml", body: '<h1 id="same">唯一锚点</h1><p>正文。</p>' }],
    nav: [{ label: "甲", href: "duplicate.xhtml#same" }, { label: "乙", href: "duplicate.xhtml#same" }],
  }, { tocQuality: "spine_fallback", sectionCount: 1, nodeCount: 1, warningCodes: ["TOC_SPINE_FALLBACK"] }),

  fixture("missing-anchor", "缺失 anchor", {
    sections: [{ id: "s1", href: "missing.xhtml", body: '<h1 id="exists">标题</h1><p>正文。</p>' }],
    nav: [{ label: "缺失锚点", href: "missing.xhtml#absent" }],
  }, { tocQuality: "spine_fallback", sectionCount: 1, nodeCount: 1, warningCodes: ["TOC_SPINE_FALLBACK"] }),

  fixture("out-of-order-anchor", "乱序 anchor", {
    sections: [{ id: "s1", href: "order.xhtml", body: '<h2 id="first">先</h2><p>甲。</p><h2 id="second">后</h2><p>乙。</p>' }],
    nav: [{ label: "后", href: "order.xhtml#second" }, { label: "先", href: "order.xhtml#first" }],
  }, { tocQuality: "spine_fallback", sectionCount: 1, nodeCount: 1, warningCodes: ["TOC_SPINE_FALLBACK"] }),

  fixture("ncx-nav-conflict", "NCX 与 EPUB3 nav 冲突", {
    sections: [{ id: "s1", href: "conflict.xhtml", body: '<h1 id="start">正文标题</h1><p>正文。</p>' }],
    nav: [{ label: "NAV 标题", href: "conflict.xhtml#start" }],
    ncx: [{ label: "NCX 标题", href: "conflict.xhtml#start" }],
  }, { tocQuality: "declared", sectionCount: 1, nodeCount: 1, labels: ["NCX 标题"] }),

  fixture("spine-fallback", "无 TOC 的 spine fallback", {
    sections: [
      { id: "s1", href: "fallback-one.xhtml", body: "<h1>卷一</h1><p>甲。</p>" },
      { id: "s2", href: "fallback-two.xhtml", body: "<h1>卷二</h1><p>乙。</p>" },
    ],
  }, { tocQuality: "spine_fallback", sectionCount: 2, nodeCount: 2, labels: ["卷一", "卷二"], warningCodes: ["TOC_SPINE_FALLBACK"] }),

  fixture("media-footnote", "空 section、图片与脚注", {
    sections: [
      { id: "s1", href: "empty.xhtml", body: '<img src="cover.jpg" alt="封面" />' },
      { id: "s2", href: "notes.xhtml", body: '<p>正文<a epub:type="noteref" href="#note">1</a></p><aside id="note" epub:type="footnote">脚注内容。</aside>' },
    ],
  }, { tocQuality: "spine_fallback", sectionCount: 2, nodeCount: 2, warningCodes: ["TOC_SPINE_FALLBACK"] }),

  fixture("normalization", "p/pre/br/list/table 与 Unicode 规范化", {
    sections: [{
      id: "s1",
      href: "normalize.xhtml",
      body: '<p id="start">Cafe\u0301<br/>下一行</p><pre>  a\n\n\n b  </pre><ul><li>一</li><li>二</li></ul><table><tr><td>甲</td><td>乙</td></tr></table>',
    }],
    nav: [{ label: "规范化", href: "normalize.xhtml#start" }],
  }, { tocQuality: "declared", sectionCount: 1, nodeCount: 1, labels: ["规范化"] }),

  fixture("large-leaf", "超大叶子 node", {
    sections: [{ id: "s1", href: "large.xhtml", body: `<h1 id="large">大节</h1><p>${repeated}</p>` }],
    nav: [{ label: "大节", href: "large.xhtml#large" }],
  }, { tocQuality: "declared", sectionCount: 1, nodeCount: 1, warningCodes: ["LARGE_LEAF_NODE"] }),

  fixture("next-section-zero", "end 位于下一 XHTML offset 0", {
    sections: [
      { id: "s1", href: "first.xhtml", body: "<h1>第一节</h1><p>甲。</p>" },
      { id: "s2", href: "second.xhtml", body: "<h1>第二节</h1><p>乙。</p>" },
    ],
    nav: [{ label: "第一节", href: "first.xhtml" }, { label: "第二节", href: "second.xhtml" }],
  }, { tocQuality: "declared", sectionCount: 2, nodeCount: 2, labels: ["第一节", "第二节"] }),

  fixture("tiny-adjacent", "多个相邻极小 node", {
    sections: [{
      id: "s1",
      href: "tiny.xhtml",
      body: '<span id="a">甲</span><span id="b">乙</span><span id="c">丙</span><span id="d">丁</span>',
    }],
    nav: [
      { label: "甲", href: "tiny.xhtml#a" },
      { label: "乙", href: "tiny.xhtml#b" },
      { label: "丙", href: "tiny.xhtml#c" },
      { label: "丁", href: "tiny.xhtml#d" },
    ],
  }, { tocQuality: "declared", sectionCount: 1, nodeCount: 4, labels: ["甲", "乙", "丙", "丁"] }),
];

function fixture(
  id: string,
  description: string,
  input: FixtureInput,
  expected: InspectorEpubFixture["expected"],
): InspectorEpubFixture {
  return { id, description, epub: buildEpub(input), expected };
}

function buildEpub(input: FixtureInput): Buffer {
  const zip = new AdmZip();
  zip.addFile("mimetype", Buffer.from("application/epub+zip"));
  zip.addFile("META-INF/container.xml", Buffer.from(`<?xml version="1.0"?>
    <container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
      <rootfiles><rootfile full-path="EPUB/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
    </container>`));

  for (const section of input.sections) {
    zip.addFile(`EPUB/${section.href}`, Buffer.from(`<!doctype html><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>${escapeXml(section.id)}</title></head><body>${section.body}</body></html>`));
  }
  if (input.nav) {
    zip.addFile("EPUB/nav.xhtml", Buffer.from(`<!doctype html><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol>${navList(input.nav)}</ol></nav></body></html>`));
  }
  if (input.ncx) {
    zip.addFile("EPUB/toc.ncx", Buffer.from(`<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap>${ncxList(input.ncx)}</navMap></ncx>`));
  }

  const manifest = input.sections.map((section) => (
    `<item id="${escapeXml(section.id)}" href="${escapeXml(section.href)}" media-type="application/xhtml+xml"/>`
  )).join("");
  const navManifest = input.nav
    ? '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>'
    : "";
  const ncxManifest = input.ncx
    ? '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>'
    : "";
  const spine = input.sections.map((section) => `<itemref idref="${escapeXml(section.id)}"/>`).join("");
  zip.addFile("EPUB/content.opf", Buffer.from(`<?xml version="1.0"?>
    <package xmlns="http://www.idpf.org/2007/opf" version="3.0">
      <manifest>${manifest}${navManifest}${ncxManifest}</manifest>
      <spine${input.ncx ? ' toc="ncx"' : ""}>${spine}</spine>
    </package>`));
  return zip.toBuffer();
}

function navList(nodes: FixtureTocNode[]): string {
  return nodes.map((node) => `<li><a href="${escapeXml(node.href)}">${escapeXml(node.label)}</a>${node.children?.length ? `<ol>${navList(node.children)}</ol>` : ""}</li>`).join("");
}

function ncxList(nodes: FixtureTocNode[], prefix = "n"): string {
  return nodes.map((node, index) => {
    const id = `${prefix}-${index}`;
    return `<navPoint id="${id}"><navLabel><text>${escapeXml(node.label)}</text></navLabel><content src="${escapeXml(node.href)}"/>${node.children?.length ? ncxList(node.children, id) : ""}</navPoint>`;
  }).join("");
}

function escapeXml(value: string): string {
  return value.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;").replace(/"/gu, "&quot;");
}
