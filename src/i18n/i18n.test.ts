import { expect, test } from "bun:test";
import en from "./en";
import id from "./id";
import { translate, useLocale, localizeMessage } from "./index";

const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test("Indonesian uses the same placeholders as English", () => {
  for (const key of Object.keys(en) as (keyof typeof en)[]) {
    expect({ key, vars: vars(id[key]) }).toEqual({ key, vars: vars(en[key]) });
  }
});

test("translate fills variables and defaults to English", () => {
  expect(useLocale.getState().locale).toBe("en");
  expect(translate("en", "scenes.title", { n: 3 })).toBe("Scenes (3)");
  expect(translate("id", "scenes.title", { n: 3 })).toBe("Scene (3)");
});

test("backend errors are localized for Indonesian only", () => {
  expect(localizeMessage("Not found: a.txt")).toBe("Not found: a.txt");
  useLocale.getState().setLocale("id");
  expect(localizeMessage("Not found: a.txt")).toBe("Tidak ditemukan: a.txt");
  expect(localizeMessage("something else")).toBe("something else");
  useLocale.getState().setLocale("en");
});
