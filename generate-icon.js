import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function createPlaceholderIcon() {
  const iconPath = path.join(__dirname, 'build', 'icon.png');
  
  // Create a 512x512 black square with a white square outline and text "My Workspace"
  // just like the attached image, as a placeholder until the user uploads their own.
  
  const svg = `
    <svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
      <rect width="512" height="512" fill="#F8F9FA"/>
      <rect x="64" y="192" width="128" height="128" rx="32" fill="#000000"/>
      <rect x="96" y="224" width="64" height="64" rx="16" fill="none" stroke="#FFFFFF" stroke-width="8"/>
      <text x="224" y="280" font-family="Arial, sans-serif" font-size="64" font-weight="bold" fill="#000000">My Workspace</text>
    </svg>
  `;

  await sharp(Buffer.from(svg))
    .png()
    .toFile(iconPath);
    
  console.log('Placeholder icon.png created in build/ folder!');
}

createPlaceholderIcon().catch(console.error);
