import fs from 'fs';
if (fs.existsSync('al-muttahida-backend/login.json')) {
  console.log(fs.readFileSync('al-muttahida-backend/login.json', 'utf8').substring(0, 500));
} else {
  console.log("No login.json");
}
