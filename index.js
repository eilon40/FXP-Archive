import { existsSync, readFileSync, writeFileSync } from 'fs';
import { DatabaseSync } from 'node:sqlite';
import ky from 'ky'; // npm i ky

const settings = {
    topposters: {
        enabled: true,
        hookId: ''
    },
    announcements: {
        enabled: true,
        hookId: ''
    },
    staff_tracking: {
        enabled: true,
        hookId: ''
    },
    daily: {
        enabled: true,
        hookId: ''
    },
    userscript: {
        enabled: true,
        hookId: '',
    }
}

const ACCESS_KEY = '';
const SECRET_KEY = '';
const runIf = (setting, cb) => setting.enabled && cb(setting.hookId)
const api = ky.create({ 
    prefixUrl: 'https://script.google.com/macros/s/'
});
const fxpInstance = ky.create({ 
    prefixUrl: 'https://www.fxp.co.il/'
});
const discordInstance = ky.create({
    prefixUrl: 'https://discord.com/api/webhooks/',
    headers: {
        'content-type': 'application/json',
    }
});
const db = new DatabaseSync('mydatabase.sqlite');
const getAll = query => db.prepare(query).all();
const sendMsg = (content, channel) => content.length > 0 && discordInstance.post(channel, { json: { content, flags: 4 }});

db.exec(`
    CREATE TABLE IF NOT EXISTS staff_tracking (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userid INTEGER NOT NULL,
        username TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        join_date DATETIME, 
        leave_date DATETIME
    );

    CREATE TABLE IF NOT EXISTS announcements_threads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_url VARCHAR(500) NOT NULL UNIQUE,
        archive_url VARCHAR(500) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        open_at VARCHAR(500) NOT NULL,
        closed_at DATETIME NULL,
        author_name VARCHAR(255) NOT NULL,
        author_id VARCHAR(255) NOT NULL,
        title VARCHAR(255) NOT NULL,
        replies INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS fxp_pages (
        id INTEGER AUTO_INCREMENT PRIMARY KEY,
        page_url VARCHAR(500) NOT NULL,  
        archive_url VARCHAR(500) NOT NULL,   
        saved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        is_pinned BOOLEAN DEFAULT FALSE 
    );
`);

async function savePage(url) {
    try {
        const json = await ky.post('https://web.archive.org/save', {
            headers: {
                Accept: 'application/json',
                Authorization: `LOW ${ACCESS_KEY}:${SECRET_KEY}`,
            },
            body: new URLSearchParams({
                url,
                capture_all: '0',
                skip_first_archive: '1',
                outlinks_availability: '1',
                if_not_archived_within: '86400',
                save_favicon: '1'
                // capture_outlinks: '1',
                // capture_screenshot: '1'
            }),
            timeout: 120000
        }).json();

        return await getJob(json.job_id)
    } finally {
        clearTimeout(timeout);
    }
}


async function getJob(jobId) {
    let json = await ky(`https://web.archive.org/save/status/${jobId}`).json();
    while(json.status != 'success') {
        console.log(jobId);
        json = await ky(`https://web.archive.org/save/status/${jobId}`).json();
        await new Promise(r => setTimeout(r, 1000));
    }
    return json;
}

runIf(settings.announcements, async function(hookId) {
    const data = await api.get('AKfycbwNmtswtfu6ZNHAdi1ANpUUL5dYnBJLYnDwQJIONrFyQ8ulyF21qIYnvICqUcyuzMt0Lw/exec?f=125').json();
    const fthreads = data.threads.filter(t => t.isLocked === false);
    for (const th of fthreads) {
        const t = await api.get('AKfycby84tu3GwS8AxvgG3gOJy2qGwo0ecPLBf-q5cp18WVyMVwQdufBL0kEX-Cc9S4Evu0ILg/exec?t='+th.threadId).json();
        db.prepare(`INSERT OR IGNORE INTO announcements_threads (thread_url, author_name, author_id, title, open_at) VALUES (?, ?, ?, ?, ?)`)
            .run('https://www.fxp.co.il/showthread.php?t='+th.threadId, th.author.username, th.author.userId, th.title, t.publishedAt);
    }
    const rows = getAll('SELECT * FROM announcements_threads WHERE archive_url IS NULL;');
    console.log(rows);
    rows.forEach(async row => {
        console.log(`Checking thread: ${row.thread_url}`);
        const li = data.threads.find(t => t.threadId == row.thread_url.split('=')[1]);

        if (!li.isLocked) {
            return console.log(`Thread ${row.thread_url} is still OPEN`);
        }
        console.log(`Thread ${row.thread_url} is now LOCKED!`);
        const replies = parseInt(li.totalReplies) || 0;
        const res = await savePage(row.thread_url);
        const stmt = db.prepare('UPDATE announcements_threads SET closed_at = datetime(\'now\'), replies = ?, archive_url = ? WHERE thread_url = ?');
        stmt.run(replies, `https://web.archive.org/web/${res.timestamp}/${row.thread_url}`, row.thread_url);
        sendMsg(`[${row.title}](${row.thread_url}) ננעל ונשמר בארכיון [קישור](https://web.archive.org/web/${res.timestamp}/${row.thread_url})`, hookId);
    });
});

runIf(settings.topposters, async function(hookId) {
    const place = [':first_place: ', ':second_place: ', ':third_place:'];
    const ids = [
        '1313095', '162287', '1137812', '1344943', '130498', '752752', '82400',
        '898448', '1239705', '499760', '771327', '493', '843383', '684887'
    ];
    const url = 'AKfycbwcaY7GZg2_kZxOJInVIh0N0HEmqe0sBBkWwzAsjFSDqxQ8U-Bh6-cay2Aep8cQChDEbQ/exec?u=';
    const data = await Promise.all(ids.map(id => api.get(url + id).json()));
    const sort = data.sort((a, b) => parseInt(b.postCount.replace(/,/g, '')) - parseInt(a.postCount.replace(/,/g, '')));
    let content = '';
    sort.forEach((user, index) => {
        const likes = user.likeCount.toLocaleString('en-US');
        if (place[index]) content += place[index];
        content += `[**${user.username}**](https://fxp.co.il/member.php?u=${user.userId})\n💬 ${user.postCount}  ♥️ ${likes}  👥 ${user.followerCount}\n\n`;
    });
    content += `\n**Last Update:** ${new Date().toUTCString()}`;
    console.log(content);
    discordInstance.patch(hookId, { json: { content, flags: 4} });
});

runIf(settings.daily, async function (hookId) {
    const stmt = db.prepare('INSERT INTO fxp_pages (page_url, archive_url) VALUES (?, ?)');
    const [daily, staticList] = await Promise.all([
        ky('https://pastebin.com/raw/6vgWuWPP').text(),
        ky('https://pastebin.com/raw/4MTDw7ET').text()
    ]);
    const urlD = (daily + '\n' + staticList).replace(/#/g, '').split('\n').map(u => u.trim()).filter(Boolean);
    for (const url of urlD) {
        const res = await savePage(url);
        console.log(res);
        const archive = `https://web.archive.org/web/${res.timestamp}/${url}`;
        stmt.run(url, archive);
        sendMsg(`[הדף](${url}) נשמר בארכיון וניתן לגשת אליו כאן: [Archived Link](${archive})`, hookId);
    }
});

runIf(settings.userscript, async function(hookId) {
    const curr = await ky('https://api.greasyfork.org/en/scripts/by-site/fxp.co.il.json?filter_locale=0').text()
    const prev = existsSync('userscript.json') ? readFileSync('userscript.json', 'utf8') : '';
    if (curr === prev) return;
    
    writeFileSync('userscript.json', curr);
    sendMsg('נמצא שינוי בתוספי המשתמש', hookId);
});

runIf(settings.staff_tracking, async function(hookId) {
    const adminRegex = /<a href="member\.php\?u=(\d+)" class="username[^"]*" title="([^"]*)">/g;
    let admins = new Map();
    const html = await fxpInstance.get('showgroups.php').text();
    for (const match of html.matchAll(adminRegex)) { 
        const name = match[2].replace(/(לא מחובר\/ת|מחובר\/ת כרגע)/g, '').trim();
        admins.set(match[1], name);
    }
    admins = Array.from(admins.entries());

    const allIds = getAll('SELECT userid FROM staff_tracking').map(r => r.userid);
    const values = admins
        .filter(([id]) => !allIds.includes(parseInt(id)))
        .map(([id, name]) => `('${id}', '${name.replace(/'/g, '\'\'')}', datetime('now'))`)
        .join(', ');

    if (values.length) {
        db.exec(`INSERT OR IGNORE INTO staff_tracking (userid, username, join_date) VALUES ${values}`);
    }

    const newRows = getAll(`SELECT * FROM staff_tracking WHERE userid NOT IN (${allIds.join(',')})`);
    const adminsIds = admins.map(a => a[0]);

    let toLeave = [];
    if (adminsIds.length) {
        toLeave = getAll(`SELECT * FROM staff_tracking WHERE leave_date IS NULL AND userid NOT IN (${adminsIds.join(',')})`);
        db.prepare(`
            UPDATE staff_tracking SET leave_date = datetime('now')
            WHERE leave_date IS NULL AND userid NOT IN (${adminsIds.join(',')})
        `).run();
    } else {
        toLeave = getAll('SELECT * FROM staff_tracking WHERE leave_date IS NULL');
        db.exec('UPDATE staff_tracking SET leave_date = datetime(\'now\') WHERE leave_date IS NULL');
    }

    const msg1 = toLeave.map(user => `המשתמש [${user.username}](https://fxp.co.il/member.php?u=${user.userid}) עזב את צוות האתר.`).join('\n');
    sendMsg(msg1, hookId);
    const msg2 = newRows.map(user =>  `המשתמש [${user.username}](https://fxp.co.il/member.php?u=${user.userid}) הצטרף לצוות האתר.`).join('\n');
    sendMsg(msg2, hookId);  

    console.log('Users who joined:', newRows);
    console.log('Users who left:', toLeave);

});
