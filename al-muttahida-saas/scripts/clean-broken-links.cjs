const fs = require('fs');
const path = require('path');

function cleanBrokenLinks(dir) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    try {
      const lstat = fs.lstatSync(fullPath);
      if (lstat.isSymbolicLink()) {
        try {
          fs.statSync(fullPath); // will throw if target doesn't exist
        } catch (err) {
          console.log('Removing broken symlink:', fullPath);
          fs.unlinkSync(fullPath);
        }
      } else if (lstat.isDirectory()) {
        if (entry.name !== '.git') {
          cleanBrokenLinks(fullPath);
        }
      }
    } catch (err) {
      console.log('Removing unreadable/broken entry:', fullPath);
      try {
        fs.rmSync(fullPath, { recursive: true, force: true });
      } catch (_) {}
    }
  }
}

const backendModules = path.resolve(__dirname, '../../al-muttahida-backend/node_modules');
console.log('Cleaning broken links in:', backendModules);
cleanBrokenLinks(backendModules);

const releaseDir = path.resolve(__dirname, '../release');
if (fs.existsSync(releaseDir)) {
  const toClean = ['win-unpacked', 'win-ia32-unpacked'];
  for (const sub of toClean) {
    const p = path.join(releaseDir, sub);
    if (fs.existsSync(p)) {
      console.log('Cleaning broken links in:', p);
      cleanBrokenLinks(p);
    }
  }
  const files = fs.readdirSync(releaseDir);
  for (const f of files) {
    if (f.endsWith('.7z')) {
      try {
        fs.unlinkSync(path.join(releaseDir, f));
        console.log('Removed partial 7z:', f);
      } catch (_) {}
    }
  }
}

console.log('All broken links cleaned successfully!');
