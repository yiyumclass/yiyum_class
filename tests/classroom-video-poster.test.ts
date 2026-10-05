import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../src/components/learning/CourseClassroom.tsx", import.meta.url), "utf8");
const file = ts.createSourceFile("CourseClassroom.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function muxPlayerAttributes() {
  let attributes: ts.JsxAttributes | undefined;
  function visit(node: ts.Node) {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(file) === "MuxPlayer") {
      attributes = node.attributes;
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert.ok(attributes, "The classroom must retain its Mux player");
  return attributes.properties.filter(ts.isJsxAttribute);
}

test("playable lessons explicitly disable the shared course poster and automatic poster fallback", () => {
  const poster = muxPlayerAttributes().find((attribute) => attribute.name.getText(file) === "poster");
  assert.ok(poster?.initializer && ts.isStringLiteral(poster.initializer));
  assert.equal(poster.initializer.text, "");
});

test("removing the shared poster preserves signed playback and inline mobile playback", () => {
  const attributes = muxPlayerAttributes();
  const attributeText = (name: string) => attributes.find((attribute) => attribute.name.getText(file) === name)?.getText(file);
  assert.equal(attributeText("playbackId"), "playbackId={muxPlayback.playbackId}");
  assert.equal(attributeText("tokens"), "tokens={{ playback: muxPlayback.token }}");
  assert.equal(attributeText("playsInline"), "playsInline");
  assert.equal(attributeText("preload"), 'preload="metadata"');
  assert.equal(attributeText("onError"), "onError={handleVideoError}");
  assert.equal(attributeText("onPlaying"), "onPlaying={handleVideoPlayable}");
});
