function backupGASFilesToDatedFolder() {
  // ID вашої папки для бекапів
  const SCRIPT_BACKUP_FOLDER_ID = "12gzKjO70UdRHKfGQnPJPKoaFQUbP2J8Z";
  const scriptName = DriveApp.getFileById(ScriptApp.getScriptId()).getName().replace('.gs', '');
  
  try {
    // 1. Отримуємо папку для бекапів
    const targetFolder = DriveApp.getFolderById(SCRIPT_BACKUP_FOLDER_ID);
    
    // 2. Створюємо папку з назвою проєкту та датою
    const dateStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
    const folderName = `${scriptName} - ${dateStr}`;
    let datedFolder;
    
    // Перевіряємо чи папка вже існує
    const existingFolders = targetFolder.getFoldersByName(folderName);
    datedFolder = existingFolders.hasNext() ? existingFolders.next() : targetFolder.createFolder(folderName);
    
    // 3. Отримуємо вміст поточного скрипту як JSON
    const scriptId = ScriptApp.getScriptId();
    const url = `https://script.google.com/feeds/download/export?id=${scriptId}&format=json`;
    const token = ScriptApp.getOAuthToken();
    
    const response = UrlFetchApp.fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      muteHttpExceptions: true
    });
    
    if (response.getResponseCode() !== 200) {
      throw new Error("Не вдалося експортувати скрипт: " + response.getContentText());
    }
    
    const scriptContent = JSON.parse(response.getContentText());
    
    // 4. Зберігаємо кожен файл окремо
    scriptContent.files.forEach(file => {
      const baseName = file.name.replace('.js', '').replace('.gs', '').replace('.html', '');
      let fileExt = '.gs';
      let mimeType = MimeType.PLAIN_TEXT;
      
      // Визначаємо тип файлу
      if (file.name.includes('.html')) {
        fileExt = '.html';
        mimeType = MimeType.HTML;
      }
      
      let version = 1;
      // Визначаємо наступну версію
      while (datedFolder.getFilesByName(`${baseName}_V${version}${fileExt}`).hasNext()) {
        version++;
      }
      
      // Створюємо файл бекапу
      datedFolder.createFile(`${baseName}_V${version}${fileExt}`, file.source, mimeType);
      console.log(`Збережено: ${baseName}_V${version}${fileExt}`);
    });
    
    console.log(`✅ Бекап завершено в папці: ${folderName}`);
    
  } catch (e) {
    console.error("❗ Помилка: " + e.toString());

  }
}