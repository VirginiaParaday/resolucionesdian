const ftp = require('basic-ftp');
const path = require('path');

const FTP_CONFIG = {
  host: process.env.FTP_HOST || 'ftp.imperiagroup.co',
  user: process.env.FTP_USER || 'imperiagroup@files.imperiagroup.co',
  password: process.env.FTP_PASS || '',
  port: parseInt(process.env.FTP_PORT) || 21,
  secure: false
};

const FTP_BASE_PATH = process.env.FTP_BASE_PATH || '/files/clients/billing resolutions';
const FTP_BASE_URL = process.env.FTP_BASE_URL || 'http://files.imperiagroup.co/files/clients/billing resolutions';

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
 * @param {string} remoteFileName - Name of the file on the FTP server (e.g. "2024-01-15-18762003231498.pdf")
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
    // File may not exist — log but don't throw
    console.warn(`[FTP] Could not delete ${remoteFileName}: ${err.message}`);
  } finally {
    client.close();
  }
}

/**
 * Check if a file exists on the FTP server.
 * @param {string} remoteFileName - Name of the file to check
 * @returns {boolean}
 */
async function checkPdfExistsOnFtp(remoteFileName) {
  const client = await getClient();
  try {
    await client.cd(FTP_BASE_PATH);
    const list = await client.list();
    return list.some(f => f.name === remoteFileName);
  } catch (err) {
    console.warn(`[FTP] Error checking ${remoteFileName}: ${err.message}`);
    return false;
  } finally {
    client.close();
  }
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
  checkPdfExistsOnFtp,
  getPdfUrl,
  FTP_BASE_URL
};
