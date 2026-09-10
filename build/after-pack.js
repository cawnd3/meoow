const path = require('path');
const { execFileSync } = require('child_process');

module.exports = async function afterPack(context) {
  const { appOutDir, packager } = context;
  if (process.platform !== 'win32') return; // rcedit touches only Windows deliverables
  const exeName = packager.appInfo.productFilename + '.exe';
  const exePath = path.join(appOutDir, exeName);
  const rcedit = path.join(__dirname, 'rcedit-x64.exe');
  const ico = path.join(__dirname, 'icon.ico');

  const args = [
    exePath,
    '--set-icon', ico,
    '--set-version-string', 'ProductName', 'Meoow',
    '--set-version-string', 'FileDescription', 'Meoow Browser',
    '--set-version-string', 'CompanyName', 'Meoow Team',
    '--set-version-string', 'LegalCopyright', 'Copyright © 2026 Meoow Team',
    '--set-file-version', '1.0.0.0',
    '--set-product-version', '1.0.0.0',
  ];
  execFileSync(rcedit, args, { stdio: 'inherit' });
  console.log('[afterPack] applied icon + version info to ' + exeName);
};