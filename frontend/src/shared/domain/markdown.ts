import MarkdownIt from 'markdown-it';
export const markdown = new MarkdownIt({ html: false, linkify: false, breaks: true });
// Display formatting only: model/user URLs never load remote resources.
markdown.renderer.rules.link_open = () => '';
markdown.renderer.rules.link_close = () => '';
markdown.renderer.rules.image = (tokens, index) => markdown.utils.escapeHtml(tokens[index]!.content);
markdown.inline.ruler.before('link', 'qa_citation', (state, silent) => {
  const match = /^\[\[evidence:([^\]]+)\]\]/.exec(state.src.slice(state.pos));
  if (!match) return false;
  if (!silent) { const token = state.push('qa_citation', '', 0); token.content = match[1]!; }
  state.pos += match[0].length;
  return true;
});
function renderQaCitation(id: string, env?: Record<string, unknown>) {
  const n = (env?.citationIds as string[] | undefined)?.indexOf(id) ?? -1;
  if (n < 0) return '[引用尚未验证]';
  const safe = markdown.utils.escapeHtml(id);
  const source = typeof env?.citationSourceTitle === 'string' ? `《${env.citationSourceTitle}》` : '';
  const label = markdown.utils.escapeHtml(`返回${source}来源 [${n + 1}]`);
  return `<button type="button" data-qa-citation="${safe}" data-testid="selection-qa-citation-${safe}" aria-label="${label}"${env?.disabled ? ' disabled' : ''}>[${n + 1}]</button>`;
}
markdown.renderer.rules.qa_citation = (tokens, index, _options, env) => renderQaCitation(tokens[index]!.content, env);
markdown.renderer.rules.code_inline = (tokens, index, _options, env) => {
  const content = tokens[index]!.content;
  const match = /^\[\[evidence:([^\]]+)\]\]$/.exec(content);
  if (match && (env?.citationIds as string[] | undefined)?.includes(match[1]!))
    return renderQaCitation(match[1]!, env);
  return `<code>${markdown.utils.escapeHtml(content)}</code>`;
};
export function markdownText(source: string): string {
  const tokens = markdown.parse(source, {});
  return tokens.map(token => {
    if (token.type === 'inline') return token.children!.map(t => t.type === 'softbreak' || t.type === 'hardbreak' ? '\n' : t.nesting === 0 ? t.content : '').join('');
    if (token.type === 'fence' || token.type === 'code_block') return token.content;
    return token.block && token.nesting === -1 ? '\n' : '';
  }).join('').trim();
}
