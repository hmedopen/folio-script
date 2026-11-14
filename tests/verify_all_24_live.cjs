const backend = require('../electron/chapterSnatchBackend.cjs');

const TEST_SOURCES = [
  { name: 'MangaDex', url: 'https://mangadex.org/chapter/0aaf8b27-0013-4ae0-8935-91a089466874' },
  { name: 'Asura Scans', url: 'https://asurascans.com/comics/logging-out-is-too-hard-f212c582/chapter/1' },
  { name: 'LINE Webtoon', url: 'https://www.webtoons.com/en/fantasy/tower-of-god/season-3-ep-1/viewer?title_no=95&episode_no=420' },
  { name: 'Naver Webtoon (Korea)', url: 'https://comic.naver.com/webtoon/detail?titleId=183559&no=600' },
  { name: 'Tonari no Young Jump', url: 'https://tonarinoyj.jp/episode/12207421984093802437' },
  { name: 'Kurage Bunch', url: 'https://kuragebunch.com/episode/12207421984512319617' },
  { name: 'King of Shojo', url: 'https://kingofshojo.com/logging-out-is-too-hard-chapter-20/' },
  { name: 'Rawkuma', url: 'https://rawkuma.net/chainsaw-man-chapter-1/' },
  { name: 'Thunder Scans', url: 'https://en-thunderscans.com/the-amber-sword-chapter-33/' },
  { name: 'Rokari Comics', url: 'https://rokaricomics.com/golden-chevalier-chapter-57/' },
  { name: 'Vortex Scans', url: 'https://vortexscans.org/series/reality-quest-2/chapter-230' },
  { name: 'Qi Manga', url: 'https://qimanga.com/series/one-day-i-became-a-hatchling/chapter-1' },
  { name: 'Hijala', url: 'https://en-hijala.com/series/the-build-up/chapter-203' },
  { name: 'Nyx Scans', url: 'https://nyxscans.com/series/the-villainess-wants-a-divorce!/chapter-34' },
  { name: 'Hive Toons', url: 'https://hivetoons.org/series/red-shirt/chapter-54' },
  { name: 'Rinko Comics', url: 'https://rinkocomics.com/chapter/hug-us-chapter-35/' },
  { name: 'Flame Comics', url: 'https://flamecomics.xyz/series/1/385fe46707bd150c' },
  { name: 'Demonic Scans', url: 'https://demonicscans.org/title/The-Wizard%2527s-Notes/chapter/1/1' },
  { name: 'GenZ Toons', url: 'https://genztoons.org/chapter/65f8b05e74a-65f8dc4a4e7/' },
  { name: 'ElfToon', url: 'https://elftoon.net/series/comic/infinite-evolution-from-zero/chapter/1' },
  { name: 'Kayn Scans', url: 'https://kaynscans.com/series/comic/the-dignity-of-a-chaebol/chapter/1' },
  { name: 'NuviaToon', url: 'https://nuviatoon.org/comics/my-husband-was-definitely-a-paladin/chapter/40' },
  { name: 'TW Manga', url: 'https://www.twbzmg.com/comic/chapter/dingjiqiyunqiaoqiaoxiulianqiannian-yuewenmanhua/0_0.html' },
  { name: 'RuManhua', url: 'http://www.rumanhua2.com/OjQucQi/vsUsUaF.html' }
];

async function verifyAll() {
  console.log(`Starting Live Verification for all ${TEST_SOURCES.length} sources...`);
  let passed = 0;
  let failed = 0;

  for (let i = 0; i < TEST_SOURCES.length; i++) {
    const src = TEST_SOURCES[i];
    try {
      const manifest = await backend.fetchMetadata(src.url);
      if (!manifest || !manifest.pages || manifest.pages.length === 0) {
        throw new Error('Zero pages returned');
      }
      passed++;
      console.log(`[${i + 1}/${TEST_SOURCES.length}] [PASS] ${src.name.padEnd(25)} -> ${manifest.pages.length} pages found`);
    } catch (err) {
      failed++;
      console.error(`[${i + 1}/${TEST_SOURCES.length}] [FAIL] ${src.name.padEnd(25)} -> ${err.message}`);
    }
  }

  console.log('\n=======================================');
  console.log(`RESULTS: ${passed} / ${TEST_SOURCES.length} PASSED (${failed} failed)`);
  console.log('=======================================');

  if (failed > 0) {
    process.exit(1);
  }
}

verifyAll();
