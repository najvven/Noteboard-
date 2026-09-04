export const parseSectionSheetAddress = (address: string) => {
  const match = /^([A-Z]+)([1-9]\d*)$/i.exec(address.trim());
  if (!match) return undefined;
  let column = 0;
  for (const character of match[1].toUpperCase()) {
    column = column * 26 + character.charCodeAt(0) - 64;
  }
  return { row: Number(match[2]), column };
};

export const shouldNavigateSpreadsheetCell = (
  key: string,
  textLength: number,
  caretOffset: number,
  selectionCollapsed: boolean,
) => {
  if (key === "Tab" || key === "Enter") return true;
  if (!selectionCollapsed) return false;
  if (textLength === 0) return key.startsWith("Arrow");
  if (key === "ArrowLeft") return caretOffset <= 0;
  if (key === "ArrowRight") return caretOffset >= textLength;
  return false;
};
