const ftp = require('basic-ftp');
const path = require('path');

const FTP_CONFIG = {
  host: process.env.FTP_HOST || 'ftp.imperiagroup.co',
  user: process.env.FTP_USER || 'imperiagroup@files.imperiagroup.co',
  password: process.env.FTP_PASS || 'In.8690101416/ig',
  port: parseInt(process.env.FTP_PORT) || 21,
  secure: false
};

const FTP_BASE_PATH = process.env.FTP_BASE_PATH || '/files/clients/billing_resolutions';
const FTP_BASE_URL = process.env.FTP_BASE_URL || 'http://files.imperiagroup.co/imperiagroup/files/clients/billing_resolutions';

/**
 * Get a connected FTP client. Caller must close it after use.
 */
async function getClient() {
  const client = new ftp.Client();
  client.ftp.verbose = false;
  await client.access(FTP_CONFIG);
  return client;
}

/**
 * Upload a local file to the FTP server.
 * @param {string} localFilePath - Absolute path to the local file
 * @param {string} remoteFileName - Name of the file on the FTP server
 */
async function uploadPdfToFtp(localFilePath, remoteFileName) {
  const client = await getClient();
  try {
    await client.ensureDir(FTP_BASE_PATH);
    await client.uploadFrom(localFilePath, remoteFileName);
    console.log(`[FTP] Uploaded: ${remoteFileName}`);
  } finally {
    client.close();
  }
}

/**
 * Delete a file from the FTP server.
 * @param {string} remoteFileName - Name of the file to delete
 */
async function deletePdfFromFtp(remoteFileName) {
  const client = await getClient();
  try {
    await client.cd(FTP_BASE_PATH);
    await client.remove(remoteFileName);
    console.log(`[FTP] Deleted: ${remoteFileName}`);
  } catch (err) {
    console.warn(`[FTP] Could not delete ${remoteFileName}: ${err.message}`);
  } finally {
    client.close();
  }
}

/**
 * Check if a PDF exists via HTTP HEAD request to the public URL.
 * This works from any server (including Railway which blocks FTP port 21).
 * @param {string} remoteFileName - Name of the file to check
 * @returns {boolean}
 */
async function checkPdfExistsHttp(remoteFileName) {
  try {
    const url = `${FTP_BASE_URL}/${encodeURIComponent(remoteFileName)}`;
    const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch (err) {
    return false;
  }
}

/**
 * Batch-check multiple PDF filenames via HTTP HEAD requests.
 * Runs all requests in parallel for speed.
 * @param {string[]} fileNames - Array of filenames to check
 * @returns {Set<string>} Set of filenames that exist
 */
async function checkPdfsBatchHttp(fileNames) {
  const results = await Promise.allSettled(
    fileNames.map(async (name) => {
      const exists = await checkPdfExistsHttp(name);
      return { name, exists };
    })
  );
  const existingFiles = new Set();
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value.exists) {
      existingFiles.add(r.value.name);
    }
  }
  return existingFiles;
}

/**
 * Get the public URL for a PDF file.
 * @param {string} remoteFileName - Name of the file
 * @returns {string} Full public URL
 */
function getPdfUrl(remoteFileName) {
  return `${FTP_BASE_URL}/${encodeURIComponent(remoteFileName)}`;
}

module.exports = {
  uploadPdfToFtp,
  deletePdfFromFtp,
  checkPdfExistsHttp,
  checkPdfsBatchHttp,
  getPdfUrl,
  FTP_BASE_URL
};
