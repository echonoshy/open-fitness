import { createContext, useContext } from "react";
import english from "./en.json";
import type { Movement } from "../core/movement-library";

export type InterfaceLanguage = "zh-CN" | "en";
const messages: Readonly<Record<string, string>> = english;
const chinese = /[\u3400-\u9fff]/;
const slots = /\{(\d+)\}/g;

// A few UI labels arrive already formatted from the training engine. Match
// the complete message, never replace arbitrary fragments of a user's text.
const formatted = Object.entries(messages)
  .filter(
    ([key]) =>
      key.includes("{0}") && chinese.test(key) && !key.includes("{0}{1}"),
  )
  .sort(([a], [b]) => b.length - a.length)
  .map(([key, value]) => {
    const parts = key.split(/(\{\d+\})/);
    const pattern = parts
      .map((part) =>
        /^\{\d+\}$/.test(part)
          ? "(.+?)"
          : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      )
      .join("");
    return { pattern: new RegExp("^" + pattern + "$"), value };
  });

export function createUiLocale(
  language: InterfaceLanguage,
  movements: readonly Movement[] = [],
) {
  const names = new Map(
    language === "en"
      ? movements.map((m) => [m.name, m.originalName] as const)
      : [],
  );
  function translate(value: string): string {
    if (language !== "en" || !chinese.test(value)) return value;
    const key = value.trim().replace(/\s+/g, " ");
    const pad = (text: string) =>
      (value.match(/^\s*/)?.[0] ?? "") +
      text +
      (value.match(/\s*$/)?.[0] ?? "");
    const exact = messages[key] ?? names.get(key);
    if (exact !== undefined) return pad(exact);
    for (const { pattern, value: template } of formatted) {
      const match = pattern.exec(key);
      if (match)
        return pad(
          template.replace(slots, (_, index) =>
            translate(match[Number(index) + 1]),
          ),
        );
    }
    const parts = key.split(/( · | \/ |、)/);
    if (parts.length > 1)
      return pad(
        parts
          .map((part, i) =>
            i % 2 ? (part === "、" ? ", " : part) : translate(part),
          )
          .join(""),
      );
    return value;
  }
  function uiText<T>(value: T): T extends string ? string : T;
  function uiText(value: unknown): unknown {
    return typeof value === "string" ? translate(value) : value;
  }
  function message(source: string, ...values: (string | number)[]): string {
    const template = (language === "en" && messages[source]) || source;
    return template.replace(slots, (_, index) => String(values[Number(index)]));
  }
  return { language, uiText, message };
}

export const UiLocale = createContext(createUiLocale("zh-CN"));
export const useUiLocale = () => useContext(UiLocale);
