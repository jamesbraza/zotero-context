import { config } from "../../package.json";
import { FluentMessageId } from "../../typings/i10n";

/**
 * Unprefixed ftl key as written in addon/locale (e.g. "prefs-title").
 * The generated FluentMessageId union carries the addonRef prefix that
 * _getString adds at lookup time, so strip it for the public signature.
 */
// The generated union is prefixed in production builds and unprefixed in dev
// builds, so strip the prefix when present and pass through otherwise.
type StripAddonRef<T> = T extends `zoterocontext-${infer K}` ? K : T;
type LocaleKey = StripAddonRef<FluentMessageId>;

export { initLocale, getString };

/**
 * Initialize locale data
 */
function initLocale() {
  const l10n = new (
    typeof Localization === "undefined"
      ? ztoolkit.getGlobal("Localization")
      : Localization
  )([`${config.addonRef}-addon.ftl`], true);
  addon.data.locale = {
    current: l10n,
  };
}

/**
 * Get locale string, see https://firefox-source-docs.mozilla.org/l10n/fluent/tutorial.html#fluent-translation-list-ftl
 * @param localString ftl key
 * @param options.branch branch name
 * @param options.args args
 * @example
 * ```ftl
 * # addon.ftl
 * addon-static-example = This is default branch!
 *     .branch-example = This is a branch under addon-static-example!
 * addon-dynamic-example =
    { $count ->
        [one] I have { $count } apple
       *[other] I have { $count } apples
    }
 * ```
 * ```js
 * getString("addon-static-example"); // This is default branch!
 * getString("addon-static-example", { branch: "branch-example" }); // This is a branch under addon-static-example!
 * getString("addon-dynamic-example", { args: { count: 1 } }); // I have 1 apple
 * getString("addon-dynamic-example", { args: { count: 2 } }); // I have 2 apples
 * ```
 */
function getString(
  localeString: LocaleKey,
  branchOrOptions?:
    string | { branch?: string | undefined; args?: L10nArgs | undefined },
): string {
  const options =
    typeof branchOrOptions === "string"
      ? { branch: branchOrOptions }
      : (branchOrOptions ?? {});
  return _getString(localeString, options);
}

function _getString(
  localeString: LocaleKey,
  options: { branch?: string | undefined; args?: L10nArgs | undefined } = {},
): string {
  const localStringWithPrefix = `${config.addonRef}-${localeString}`;
  const { branch, args } = options;
  const pattern = addon.data.locale?.current.formatMessagesSync([
    { id: localStringWithPrefix, args: args ?? null },
  ])?.[0];

  if (!pattern) {
    return localStringWithPrefix;
  }
  if (branch && pattern.attributes) {
    return (
      pattern.attributes.find((attr) => attr.name === branch)?.value ||
      localStringWithPrefix
    );
  } else {
    return pattern.value || localStringWithPrefix;
  }
}
