import CodeMirror from "@uiw/react-codemirror";
import { StreamLanguage, syntaxHighlighting, HighlightStyle } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";

const graphQLLanguage = StreamLanguage.define({
  token(stream) {
    if (stream.eatSpace()) return null;
    if (stream.match(/^#[^\n]*/)) return "comment";
    if (stream.match(/^"""(?:[^"]|"(?!"")|""(?!"))*"""/)) return "string";
    if (stream.match(/^"(?:\\.|[^"\\])*"/)) return "string";
    if (stream.match(/^\$[_A-Za-z][_0-9A-Za-z]*/)) return "variableName";
    if (
      stream.match(
        /^(query|mutation|subscription|fragment|on|schema|scalar|type|interface|union|enum|input|directive|extend|implements)\b/,
      )
    ) {
      return "keyword";
    }
    if (stream.match(/^(true|false|null)\b/)) return "atom";
    if (stream.match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/)) {
      return "number";
    }
    if (stream.match(/^[_A-Za-z][_0-9A-Za-z]*/)) return "propertyName";
    stream.next();
    return null;
  },
});

const graphQLHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: "var(--cm-keyword)", fontWeight: "600" },
  { tag: tags.variableName, color: "var(--cm-variable)" },
  { tag: tags.propertyName, color: "var(--cm-property)" },
  { tag: tags.string, color: "var(--cm-string)" },
  { tag: tags.number, color: "var(--cm-number)" },
  { tag: tags.bool, color: "var(--cm-bool)", fontWeight: "600" },
  { tag: tags.null, color: "var(--cm-bool)", fontWeight: "600" },
  { tag: tags.comment, color: "var(--text-subtle)", fontStyle: "italic" },
]);

const graphQLTheme = EditorView.theme({
  "&": {
    "--cm-keyword": "#a65a42",
    "--cm-variable": "#8a5a9e",
    "--cm-property": "#476f8f",
    "--cm-string": "#5f7f4b",
    "--cm-number": "#8a5a9e",
    "--cm-bool": "#9a6a34",
    backgroundColor: "var(--surface-raised)",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: "6px",
    fontSize: "12px",
  },
  ".dark &": {
    "--cm-keyword": "#f29a78",
    "--cm-variable": "#d9b2ff",
    "--cm-property": "#9bd4ff",
    "--cm-string": "#b8df9f",
    "--cm-number": "#d9b2ff",
    "--cm-bool": "#f3c47e",
  },
  "&.cm-focused": {
    outline: "1px solid color-mix(in srgb, var(--accent) 58%, transparent)",
  },
  ".cm-content": {
    caretColor: "var(--accent)",
    fontFamily: "var(--font-mono)",
  },
  ".cm-scroller": {
    fontFamily: "var(--font-mono)",
  },
  ".cm-gutters": {
    backgroundColor: "var(--surface-sunken)",
    color: "var(--text-subtle)",
    borderRight: "1px solid var(--border)",
  },
  ".cm-activeLineGutter, .cm-activeLine": {
    backgroundColor: "color-mix(in srgb, var(--accent-wash) 60%, transparent)",
  },
});

export const graphQLEditorExtensions: Extension[] = [
  graphQLLanguage,
  syntaxHighlighting(graphQLHighlight),
  EditorView.lineWrapping,
  graphQLTheme,
];

export function GraphQLCodeEditor({
  value,
  readOnly = false,
  onChange = () => {},
  minHeight = "180px",
  maxHeight = "360px",
}: {
  value: string;
  readOnly?: boolean;
  onChange?: (value: string) => void;
  minHeight?: string;
  maxHeight?: string;
}) {
  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      extensions={[
        ...graphQLEditorExtensions,
        readOnly ? EditorState.readOnly.of(true) : [],
      ]}
      basicSetup={{
        foldGutter: true,
        highlightActiveLine: !readOnly,
        highlightActiveLineGutter: false,
        lineNumbers: true,
      }}
      theme="none"
      minHeight={minHeight}
      maxHeight={maxHeight}
      editable={!readOnly}
    />
  );
}
