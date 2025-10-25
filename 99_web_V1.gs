function doGet() {
  return HtmlService.createHtmlOutputFromFile('00_index')
    .setTitle('Домашній бюджет')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
