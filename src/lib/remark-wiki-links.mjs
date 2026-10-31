/**
 * Wiki syntax shares the existing inline parser: math, code and escapes remain opaque.
 * @param {{slugByName: Map<string, string>}} options
 */
export function remarkWikiLinks({ slugByName }) {
  const data = this.data();
  (data.micromarkExtensions ??= []).push(wikiSyntax());
  (data.fromMarkdownExtensions ??= []).push({
    canContainEols: ["wikiLink"],
    enter: {
      wikiLink(token) {
        this.enter({ type: "wikiLink", value: token._target, raw: this.sliceSerialize(token), children: [] }, token);
      },
    },
    exit: {
      wikiLink(token) {
        const node = this.stack.at(-1);
        const raw = node.value;
        const separator = raw.indexOf("|");
        const destination = separator < 0 ? raw : raw.slice(0, separator);
        const target = destination.split("#")[0].trim().replace(/\.md$/i, "").toLowerCase();
        const label = (separator < 0 ? destination : raw.slice(separator + 1)).trim() || destination.trim();
        trimEdges(node.children);
        if (!node.children.length) node.children.push({ type: "text", value: label });
        // Resolve link ancestry after raw HTML has its real tree structure.
        node.data = {
          hName: "span",
          hProperties: {
            dataSelfwikiRaw: node.raw,
            dataSelfwikiLabel: label,
            dataSelfwikiSlug: slugByName.get(target) || "",
          },
        };
        this.exit(token);
      },
    },
  });
}

function trimEdges(children) {
  if (children[0]?.type === "text") children[0].value = children[0].value.trimStart();
  if (children.at(-1)?.type === "text") children.at(-1).value = children.at(-1).value.trimEnd();
  while (children[0]?.type === "text" && !children[0].value) children.shift();
  while (children.at(-1)?.type === "text" && !children.at(-1).value) children.pop();
}

function wikiSyntax() {
  const openAliases = new WeakMap();
  const opener = { name: 'wikiLinkStart', tokenize: tokenizeStart, resolve: recordAlias, resolveAll: resolveUnmatched };
  const closer = { name: 'wikiLinkEnd', tokenize: tokenizeEnd, resolveTo: resolveEnd };
  return { text: { 91: opener, 93: closer }, insideSpan: { null: [opener] } };
  function tokenizeStart(effects, ok, nok) {
    let token, target = '';
    return first;
    function first(code) {
      token = effects.enter('wikiLinkStart');
      effects.consume(code);
      return second;
    }
    function second(code) {
      if (code !== 91)
        return nok(code);
      effects.consume(code);
      return targetInside;
    }
    function targetInside(code) {
      if (code === null || code < 0 || code === 91)
        return nok(code);
      if (code === 124) {
        if (!target.trim())
          return nok(code);
        effects.consume(code);
        token._target = target + '|';
        effects.exit('wikiLinkStart');
        return ok;
      }
      if (code === 93) {
        if (!target.trim())
          return nok(code);
        effects.consume(code);
        return last;
      }
      target += String.fromCodePoint(code);
      effects.consume(code);
      return targetInside;
    }
    function last(code) {
      if (code !== 93)
        return nok(code);
      effects.consume(code);
      token._target = target;
      token.type = 'wikiLink';
      effects.exit('wikiLink');
      return ok;
    }
  }
  function recordAlias(events, context) {
    // Count only committed openers: a failed tokenizer attempt must not leak state.
    if (events[0][1].type === 'wikiLinkStart') {
      openAliases.set(context.events, (openAliases.get(context.events) ?? 0) + 1);
    }
    return events;
  }
  function tokenizeEnd(effects, ok, nok) {
    const events = this.events;
    if (!openAliases.get(events))
      return nok;
    let closing;
    return first;
    function first(code) { closing = effects.enter('wikiLinkEnd'); effects.consume(code); return second; }
    function second(code) {
      if (code !== 93)
        return nok(code);
      let open = events.length;
      while (open-- > 0)
        if (events[open][0] === 'enter' && events[open][1].type === 'wikiLinkStart')
          break;
      if (open < 0) {
        openAliases.set(events, 0);
        return nok(code);
      }
      closing._openIndex = open;
      effects.consume(code);
      effects.exit('wikiLinkEnd');
      return ok;
    }
  }
  function resolveEnd(events, context) {
    const close = events.length - 2;
    const open = events[close][1]._openIndex;
    openAliases.set(events, Math.max(0, openAliases.get(events) - 1));
    const start = events[open][1];
    const end = events[close][1];
    const group = { type: 'wikiLink', start: { ...start.start }, end: { ...end.end }, _target: start._target + context.sliceSerialize({ start: start.end, end: end.start }) };
    let middle = events.slice(open + 2, close);
    const resolved = [];
    for (const construct of context.parser.constructs.insideSpan.null ?? []) {
      if (construct.resolveAll && !resolved.includes(construct.resolveAll)) {
        middle = construct.resolveAll(middle, context);
        resolved.push(construct.resolveAll);
      }
    }
    events.length = open;
    events.push(['enter', group, context]);
    for (const event of middle)
      events.push(event);
    events.push(['exit', group, context]);
    return events;
  }
  function resolveUnmatched(events) {
    for (const event of events)
      if (event[1].type === 'wikiLinkStart')
        event[1].type = 'data';
    return events;
  }
}
