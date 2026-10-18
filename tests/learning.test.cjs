const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');

const html = readFileSync(require('node:path').join(__dirname, '../practice.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

// A small DOM stand-in keeps session and scheduling checks dependency-free.
function app(language = "en", stored = new Map()) {
  const elements = new Map();
  for (const tag of html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)) {
    const classes = new Set((tag[0].match(/class="([^"]*)"/)?.[1] || '').split(' '));
    elements.set(tag[1], {
      value: '', textContent: '', disabled: false, innerHTML: '',
      classList: {
        add: name => classes.add(name), remove: name => classes.delete(name),
        contains: name => classes.has(name),
        toggle(name, force) { const show = force ?? !classes.has(name); show ? classes.add(name) : classes.delete(name); return show; },
      },
      focus() {}, setAttribute() {}, removeAttribute() {},
    });
  }
  const context = vm.createContext({
    document: { getElementById: id => elements.get(id), querySelectorAll: () => [], body: {}, documentElement: { dataset: {} }, createTreeWalker: () => ({ nextNode: () => null }) },
    window: { scrollTo() {}, addEventListener() {} },
    location: { search: "?lang=" + language }, URLSearchParams, NodeFilter: { SHOW_TEXT: 4 },
    localStorage: { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) },
    Intl, Date, console, ProgressRecords: require('../progress-records.js'),
  });
  vm.runInContext(script, context);
  return { run: code => vm.runInContext(code, context), el: id => elements.get(id) };
}

test('new sentences do not appear in the due-review count', () => {
  const a = app();
  assert.equal(a.el('total').textContent, 10);
  assert.equal(a.el('due').textContent, 0);
  a.run('schedule(data[0],0)');
  assert.equal(a.el('due').textContent, 1);
});

test('study completion preserves the card and supports a new session', () => {
  const a = app();
  a.run('startStudy()');
  const count = a.run('studyQueue.length');
  for (let i = 0; i < count; i++) a.run('revealStudy();grade(2)');
  assert.equal(a.el('studydone').classList.contains('hidden'), false);
  assert.equal(a.el('studyprogress').value, count);
  a.run('startStudy()');
  assert.equal(a.el('studybox').classList.contains('hidden'), false);
  assert.equal(a.el('studydone').classList.contains('hidden'), true);
  assert.ok(a.el('studyprompt').textContent);
  assert.equal(a.el('studyprogress').value, 0);
});

test('opening a session from navigation initializes its questions', () => {
  const a = app();
  a.run('showTab("study")');
  assert.ok(a.el('studyprompt').textContent);
  a.run('showTab("quiz")');
  assert.ok(a.el('quizprompt').textContent);
});

test('quiz requires an answer or an explicit skip and records each grade once', () => {
  const a = app();
  a.run('startQuiz();checkQuiz()');
  assert.equal(a.el('quizinput').disabled, false);
  assert.equal(a.el('quizresult').classList.contains('hidden'), true);
  a.run('checkQuiz(true);quizGrade(0);quizGrade(2)');
  assert.equal(a.run('quizRatings[0]'), 1);
  assert.equal(a.run('quizRatings[2]'), 0);
  assert.equal(a.run('quizQueue[0].seen'), 1);
  a.run('nextQuiz();nextQuiz()');
  assert.equal(a.run('quizIndex'), 1);
});

test('quiz completion summarizes self-assessment and can restart', () => {
  const a = app();
  a.run('startQuiz()');
  const count = a.run('quizQueue.length');
  for (let i = 0; i < count; i++) a.run('checkQuiz(true);quizGrade(1);nextQuiz()');
  assert.equal(a.el('quizdone').classList.contains('hidden'), false);
  assert.match(a.el('quizbreakdown').textContent, new RegExp('再練習 '+count+' 項'));
  a.run('startQuiz()');
  assert.equal(a.run('quizRatings.reduce((sum,n)=>sum+n,0)'), 0);
  assert.equal(a.el('quizbox').classList.contains('hidden'), false);
});

test('library combines status filtering with search and escapes imported content', () => {
  const a = app();
  a.run('schedule(data[0],0);setFilter("due")');
  assert.equal(a.el('librarycount').textContent, '1 / 10 項');
  a.el('search').value = 'not in this collection';
  a.run('renderLibrary()');
  assert.equal(a.el('librarycount').textContent, '0 / 10 項');
  a.el('search').value = '';
  a.run('data[0].english="<img src=x onerror=alert(1)>";renderLibrary()');
  assert.ok(a.el('items').innerHTML.includes('&lt;img'));
  assert.ok(!a.el('items').innerHTML.includes('<img'));
});

test('storage failure shows a visible warning instead of hiding lost persistence', () => {
  const a = app();
  a.run('localStorage.setItem=()=>{throw new Error("quota")};save()');
  assert.equal(a.el('storageStatus').classList.contains('hidden'), false);
  assert.match(a.el('storageStatus').textContent, /下載備份/);
});

test('saving learning progress marks the cloud copy as needing a backup', () => {
  const a = app();
  a.run('window.markForgeDataDirty=value=>window.lastDirtyAt=value;save()');
  assert.ok(Number(a.run('localStorage.getItem(KEY+"-updated-at")')) > 0);
  assert.ok(a.run('window.lastDirtyAt') > 0);
});

test('practice kind separates vocabulary and sentences while honoring an explicit kind', () => {
  const a = app();
  assert.equal(a.run('itemKind({english:"perfume"})'), 'word');
  assert.equal(a.run('itemKind({english:"highly efficient"})'), 'word');
  assert.equal(a.run('itemKind({english:"Let me think about it."})'), 'sentence');
  assert.equal(a.run('itemKind({english:"How are you?"})'), 'sentence');
  assert.equal(a.run('itemKind({english:"I prefer tea",kind:"sentence"})'), 'sentence');
  a.run('data.push({id:"word-test",english:"perfume",chinese:"香水",seen:0,level:0});setPracticeKind("word","study")');
  assert.equal(a.run('studyQueue.length'), 1);
  assert.equal(a.el('studyenglish').textContent, 'perfume');
  a.run('startQuiz()');
  assert.equal(a.run('quizQueue.length'), 1);
  assert.equal(a.el('quizprompt').textContent, '香水');
});

test('a kind with no content shows an empty state rather than an unrelated question', () => {
  const a = app();
  a.run('setPracticeKind("word","study")');
  assert.equal(a.el('studyempty').classList.contains('hidden'), false);
  assert.equal(a.el('studydone').classList.contains('hidden'), true);
  assert.equal(a.el('studybox').classList.contains('hidden'), true);
  a.run('showTab("quiz")');
  assert.equal(a.el('quizempty').classList.contains('hidden'), false);
  a.run('setPracticeKind("sentence","study")');
  assert.equal(a.el('studyempty').classList.contains('hidden'), true);
  assert.ok(a.run('studyQueue.length') > 0);
});

test('import and manual kind corrections retain content and learning progress', () => {
  const a = app();
  assert.equal(a.run('parseItems([{english:"I prefer tea",kind:"sentence"}])[0].kind'), 'sentence');
  assert.equal(a.run('parseItems({vocabulary:[{word:"efficient",chinese:"有效率的"}]})[0].kind'), 'word');
  assert.equal(a.run('parseItems({sentences:[{english:"I prefer tea",chinese:"我偏好茶"}]})[0].kind'), 'sentence');
  a.run('schedule(data[0],2)');
  const due = a.run('data[0].due');
  a.run('setItemKind(0,"word")');
  assert.equal(a.run('data[0].seen'), 1);
  assert.equal(a.run('data[0].due'), due);
  assert.equal(a.run('itemKind(data[0])'), 'word');
});

test('normal and slow speech reuse the shared reader and report playback errors', () => {
  const a = app();
  a.run('window.speechSynthesis={cancel(){},speak(u){window.lastUtterance=u}};speechSynthesis=window.speechSynthesis;SpeechSynthesisUtterance=function(text){this.text=text};speak("perfume",1)');
  assert.equal(a.run('window.lastUtterance.text'), 'perfume');
  assert.equal(a.run('window.lastUtterance.rate'), 1);
  a.run('speak("Let me think about it.",0.7)');
  assert.equal(a.run('window.lastUtterance.rate'), 0.7);
  a.run('window.lastUtterance.onerror({error:"audio-busy"})');
  assert.equal(a.el('speechstatus').classList.contains('hidden'), false);
});


test('shadowing can hide and reveal English without changing the material or grade', () => {
  const a = app();
  a.run('startStudy();revealStudy()');
  const english = a.el('studyenglish').textContent;
  a.run('toggleStudyText()');
  assert.equal(a.el('studyenglish').classList.contains('hidden'), true);
  assert.equal(a.el('studyextra').classList.contains('hidden'), true);
  assert.equal(a.el('hideEnglish').textContent, '顯示英文');
  a.run('toggleStudyText()');
  assert.equal(a.el('studyenglish').classList.contains('hidden'), false);
  assert.equal(a.el('studyenglish').textContent, english);
  assert.equal(a.run('studyQueue[0].seen'), 0);
});

test('adding missing vocabulary refreshes a previously empty practice session', () => {
  const a = app();
  a.run('setPracticeKind("word","study");mergeItems([{english:"efficient",chinese:"有效率的",kind:"word"}]);showTab("study")');
  assert.equal(a.el('studyempty').classList.contains('hidden'), true);
  assert.equal(a.el('studyenglish').textContent, 'efficient');
});

test('vocabulary examples speak the English sentence without its Chinese translation', () => {
  const a = app();
  assert.equal(a.run('exampleEnglish({english:"perfume",note:"She sprayed a little perfume on her wrist.（她在手腕噴了香水。）"})'), 'She sprayed a little perfume on her wrist.');
  assert.equal(a.run('exampleEnglish({english:"efficient",note:"The new machine is efficient."})'), 'The new machine is efficient.');
  assert.equal(a.run('exampleEnglish({english:"efficient",note:"這是一個形容詞。"})'), '');
  assert.equal(a.run('exampleEnglish({english:"It works.",note:"It works."})'), '');
});


test('English and Japanese use independent data and preserve existing English progress', () => {
  const stored = new Map([['english-forge-v1', JSON.stringify([{english:'Keep my progress.',chinese:'保留我的進度',seen:7,level:4,due:'2026-12-01'}])]]);
  const en = app('en', stored);
  assert.equal(en.run('KEY'), 'english-forge-v1');
  assert.equal(en.run('data[0].seen'), 7);
  const ja = app('ja', stored);
  assert.equal(ja.run('KEY'), 'japanese-forge-v1');
  assert.ok(ja.run('data.some(x=>x.english.includes("水"))'));
  ja.run('schedule(data[0],2)');
  assert.equal(JSON.parse(stored.get('english-forge-v1'))[0].seen, 7);
  assert.equal(JSON.parse(stored.get('japanese-forge-v1'))[0].seen, 1);
});

test('Japanese imports, duplicate detection and answer checking retain kana and kanji', () => {
  const a = app('ja');
  assert.notEqual(a.run('norm("猫")'), a.run('norm("犬")'));
  assert.equal(a.run('norm("水をください。")'), a.run('norm(" 水をください！ ")'));
  assert.equal(a.run('itemKind({english:"駅はどこですか。"})'), 'sentence');
  assert.equal(a.run('parseItems([{japanese:"猫",chinese:"貓",reading:"ねこ"}])[0].reading'), 'ねこ');
  assert.equal(a.run('mergeItems(parseItems([{japanese:"猫",chinese:"貓"},{japanese:"犬",chinese:"狗"}]))'), 2);
  assert.equal(a.run('mergeItems(parseItems([{japanese:"猫",chinese:"貓"}]))'), 0);
  assert.throws(()=>a.run('parseItems({language:"en",items:[{english:"hello"}]})'), /語言/);
  a.run('quizQueue=[{english:"水をください。",chinese:"請給我水"}];quizIndex=0;renderQuiz()');
  a.el('quizinput').value = '駅はどこですか。';
  a.run('checkQuiz()');
  assert.match(a.el('quizfeedback').textContent, /不同/);
});

test('Japanese speech uses a Japanese voice and explicit examples instead of reading Chinese notes', () => {
  const a = app('ja');
  a.run('window.speechSynthesis={cancel(){},speak(u){window.lastUtterance=u}};speechSynthesis=window.speechSynthesis;SpeechSynthesisUtterance=function(text){this.text=text};speak("水をください。",0.7)');
  assert.equal(a.run('window.lastUtterance.lang'), 'ja-JP');
  assert.equal(a.run('exampleEnglish({english:"水",example:"水をください。",note:"請給我水"})'), '水をください。');
  assert.equal(a.run('exampleEnglish({english:"水",note:"這是中文說明。"})'), '');
});

test('Japanese dynamic instructions remain Japanese after starting and hiding a card', () => {
  const a=app('ja');
  a.run('startStudy();revealStudy();toggleStudyText();toggleStudyText()');
  assert.ok(!a.el('pronunciationtip').textContent.includes('英文'));
  assert.ok(!a.el('hideEnglish').textContent.includes('英文'));
  assert.ok(!a.el('plandesc').textContent.includes('英文'));
});

test('Japanese preserves kana and romaji while English needs no Japanese-only fields', () => {
  const ja=app('ja'),en=app('en');
  assert.equal(ja.run('parseItems([{japanese:"猫",reading:"ねこ",romaji:"neko",chinese:"貓"}])[0].romaji'),'neko');
  assert.equal(ja.run('parseItems([{japanese:"猫",romaji:{bad:true},chinese:"貓"}])[0].romaji'),undefined);
  assert.equal(en.run('parseItems([{english:"cat",chinese:"貓"}])[0].romaji'),undefined);
  ja.run('studyQueue=[{english:"猫",reading:"ねこ",romaji:"neko",chinese:"貓",seen:0}];studyIndex=0;renderStudy();revealStudy()');
  assert.match(ja.el('studyromaji').textContent,/neko/);
  ja.run('toggleStudyText()');
  assert.equal(ja.el('studyromaji').classList.contains('hidden'),true);
  ja.run('toggleStudyText()');
  assert.equal(ja.el('studyromaji').classList.contains('hidden'),false);
});

test('Japanese JSON exports Japanese fields and preserves progress; English exports stay compatible', () => {
  const ja=app('ja'),en=app('en');
  ja.run('schedule(data[0],2)');
  const output=JSON.parse(ja.run('JSON.stringify(backupData())'));
  assert.equal(output.language,'ja');
  assert.equal(output.items[0].japanese,'水');
  assert.equal(output.items[0].reading,'みず');
  assert.equal(output.items[0].romaji,'mizu');
  assert.equal(output.items[0].seen,1);
  assert.equal(output.items[0].english,undefined);
  assert.ok(en.run('backupData().items[0].english'));
  assert.equal(en.run('backupData().items[0].japanese'),undefined);
  assert.equal(ja.run('parseItems(backupData())[0].english'),'水');
  assert.equal(ja.run('parseItems(backupData())[0].romaji'),'mizu');
});

test('Japanese library search can find kana and romaji', () => {
  const ja=app('ja');
  ja.el('search').value='mizu';ja.run('renderLibrary()');
  assert.match(ja.el('items').innerHTML,/水/);
  ja.el('search').value='しごと';ja.run('renderLibrary()');
  assert.match(ja.el('items').innerHTML,/仕事/);
});

test('reimporting Japanese can fill missing readings without overwriting content or progress', () => {
  const stored=new Map([['japanese-forge-v1',JSON.stringify([{id:'mine',english:'猫',chinese:'我的中文提示',seen:5,level:3,due:'2026-12-01'}])]]);
  const ja=app('ja',stored);
  assert.equal(ja.run('mergeItems(parseItems([{japanese:"猫",reading:"ねこ",romaji:"neko",chinese:"貓"}]))'),0);
  assert.equal(ja.run('data[0].reading'),'ねこ');
  assert.equal(ja.run('data[0].romaji'),'neko');
  assert.equal(ja.run('data[0].seen'),5);
  assert.equal(ja.run('data[0].chinese'),'我的中文提示');
  ja.run('mergeItems(parseItems([{japanese:"猫",reading:"wrong",romaji:"wrong",chinese:"wrong"}]))');
  assert.equal(ja.run('data[0].romaji'),'neko');
});

test('manual Japanese additions preserve both readings without adding Japanese fields to English', () => {
  const ja=app('ja');
  for(const [id,value] of Object.entries({newen:'猫',newzh:'貓',newreading:'ねこ',newromaji:'neko',newkind:'word'}))ja.el(id).value=value;
  ja.run('addItem()');
  assert.equal(ja.run('data.find(x=>x.english==="猫").romaji'),'neko');
  assert.equal(ja.el('newromaji').value,'');
  const en=app('en');en.el('newen').value='cat';en.el('newzh').value='貓';en.run('addItem()');
  assert.equal(en.run('data.find(x=>x.english==="cat").romaji'),undefined);
});

test('old Japanese seed readings are supplemented without changing saved progress or custom material', () => {
  const stored=new Map([['japanese-forge-v1',JSON.stringify([
    {id:'ja-seed-0',english:'水',chinese:'水',seen:6,level:4},
    {id:'custom',english:'駅',chinese:'車站',seen:2},
  ])]]);
  const ja=app('ja',stored);
  assert.equal(ja.run('data[0].romaji'),'mizu');
  assert.equal(ja.run('data[0].seen'),6);
  assert.equal(ja.run('data[1].romaji'),undefined);
});


test('Japanese cards hide the translation provenance notice and preserve other notes', () => {
  const a = app('ja');
  const notice = '中文為匯入時補充翻譯，非 Notion 原文。';
  for (const extra of ['', '讀音可能漏字。']) {
    a.run('data=[{english:"水",chinese:"水",source:"Notion Japan",note:'+JSON.stringify(extra+notice)+'}];startStudy();renderLibrary()');
    assert.equal(a.el('studyextra').textContent, extra || 'Notion Japan');
    assert.ok(!a.el('items').innerHTML.includes(notice));
    assert.equal(a.el('items').innerHTML.includes('<details>'), !!extra);
    if (extra) assert.ok(a.el('items').innerHTML.includes(extra));
    assert.equal(a.run('data[0].note'), extra + notice);
  }
});

test('reimporting English refreshes its text without touching progress', () => {
  const a = app();
  a.run('data=[{english:"Tent",chinese:"一種露營用的布篷。",note:"We set up our tent.",level:3,seen:1}]');
  a.run('mergeItems(parseItems([{english:"tent",chinese:"帳篷",example:"We set up our tent.（我們搭好帳篷。）"},{english:"lamp",chinese:"燈"}]))');
  assert.equal(a.run('data.length'), 2);
  assert.equal(a.run('JSON.stringify([data[0].english,data[0].chinese,data[0].note,data[0].level,data[0].seen])'), JSON.stringify(['tent','帳篷','We set up our tent.（我們搭好帳篷。）',3,1]));
  assert.equal(a.run('exampleEnglish({english:"x",note:"\\"On time\\" means not late.（準時。）"})'), '"On time" means not late.');
});

test('library and study card show practice count and times', () => {
  const a = app();
  a.run('data[0].seen=2;data[0].level=1;data[0].due="2000-01-01";data[1].seen=1;data[1].due="2999-01-01";data[1].firstStudiedAt=data[1].lastStudiedAt=Date.UTC(2026,9,17,9,0);showTab("library")');
  const html = a.el('items').innerHTML;
  assert.match(html, /練習 2 次</);
  assert.match(html, /練習 1 次 · 首次 .+ · 上次 /);
  a.run('studyQueue=[data[1]];studyIndex=0;renderStudy()');
  assert.match(a.el('studytag').textContent, /複習 · 上次 /);
});

test('deleting an item asks first and records the removal for sync', () => {
  const stored = new Map(), a = app('en', stored);
  const english = a.run('data[0].english');
  a.run('confirm=()=>false;deleteItem(0)');
  assert.equal(a.run('data[0].english'), english);
  a.run('confirm=()=>true;deleteItem(0)');
  assert.equal(a.run('data.some(x=>x.english===' + JSON.stringify(english) + ')'), false);
  const records = JSON.parse(stored.get('english-forge-v1-records'));
  assert.deepEqual(Object.keys(Object.values(records).find(r => !r.english)), ['at']);
  assert.equal(a.run('fromRecords(loadRecords()).length'), 9);
});
