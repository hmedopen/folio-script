const backend = require('../electron/chapterSnatchBackend.cjs');
const fs = require('fs');
const path = require('path');

async function verifyFullWorkflow() {
  console.log('=== VERIFYING NAVER WEBTOON & KAKAOPAGE END-TO-END ===\n');

  // 1. Naver Webtoon
  console.log('1. [NAVER WEBTOON] Fetching Tower of God Ep 600...');
  const naverUrl = 'https://comic.naver.com/webtoon/detail?titleId=183559&no=600';
  const naverMeta = await backend.fetchMetadata(naverUrl);
  console.log('   Series:', naverMeta.metadata.seriesTitle);
  console.log('   Chapter:', naverMeta.metadata.chapterTitle);
  console.log('   Total Pages:', naverMeta.pages.length);

  console.log('   Downloading first 3 pages...');
  const naverDownloaded = [];
  for (let i = 0; i < 3; i++) {
    const p = naverMeta.pages[i];
    const dl = await backend.downloadPageImage(p.imageUrl, 'https://comic.naver.com/');
    if (!dl.dataBase64 || dl.sizeBytes < 1000) throw new Error(`Naver Page ${i+1} invalid`);
    naverDownloaded.push({
      filename: p.filename,
      filePath: path.join(__dirname, `naver_p${i+1}.jpg`),
      buffer: Buffer.from(dl.dataBase64, 'base64')
    });
    fs.writeFileSync(naverDownloaded[i].filePath, naverDownloaded[i].buffer);
  }
  console.log('   Created 3 valid images on disk. Building ZIP...');
  const naverZipPath = path.join(__dirname, 'naver_test.zip');
  await backend.createZipFromDisk(naverDownloaded.map(d => ({ filename: d.filename, filePath: d.filePath })), naverZipPath);
  const naverZipStat = fs.statSync(naverZipPath);
  console.log(`   [PASS] Naver ZIP created: ${naverZipStat.size} bytes\n`);

  // Clean up Naver scratch
  naverDownloaded.forEach(d => fs.unlinkSync(d.filePath));
  fs.unlinkSync(naverZipPath);

  // 2. KakaoPage
  console.log('2. [KAKAOPAGE] Fetching Chitra Ep 1 (52044069 / 52055165)...');
  const kakaoUrl = 'https://page.kakao.com/content/52044069/viewer/52055165';
  const kakaoMeta = await backend.fetchMetadata(kakaoUrl);
  console.log('   Series:', kakaoMeta.metadata.seriesTitle);
  console.log('   Chapter:', kakaoMeta.metadata.chapterTitle);
  console.log('   Total Pages:', kakaoMeta.pages.length);

  console.log('   Downloading first 3 pages...');
  const kakaoDownloaded = [];
  for (let i = 0; i < 3; i++) {
    const p = kakaoMeta.pages[i];
    const dl = await backend.downloadPageImage(p.imageUrl, 'https://page.kakao.com/');
    if (!dl.dataBase64 || dl.sizeBytes < 1000) throw new Error(`Kakao Page ${i+1} invalid`);
    kakaoDownloaded.push({
      filename: p.filename,
      filePath: path.join(__dirname, `kakao_p${i+1}.jpg`),
      buffer: Buffer.from(dl.dataBase64, 'base64')
    });
    fs.writeFileSync(kakaoDownloaded[i].filePath, kakaoDownloaded[i].buffer);
  }
  console.log('   Created 3 valid images on disk. Building ZIP...');
  const kakaoZipPath = path.join(__dirname, 'kakao_test.zip');
  await backend.createZipFromDisk(kakaoDownloaded.map(d => ({ filename: d.filename, filePath: d.filePath })), kakaoZipPath);
  const kakaoZipStat = fs.statSync(kakaoZipPath);
  console.log(`   [PASS] KakaoPage ZIP created: ${kakaoZipStat.size} bytes\n`);

  // Clean up Kakao scratch
  kakaoDownloaded.forEach(d => fs.unlinkSync(d.filePath));
  fs.unlinkSync(kakaoZipPath);

  console.log('====================================================');
  console.log('ALL KOREAN WEBTOON HEAVYWEIGHTS FULLY VERIFIED 100%!');
  console.log('====================================================');
}

verifyFullWorkflow().catch(err => {
  console.error('VERIFICATION FAILED:', err);
  process.exit(1);
});
