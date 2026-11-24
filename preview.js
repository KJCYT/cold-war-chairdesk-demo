'use strict';

const delegates = ['甲组', '乙组', '丙组', '丁组', '戊组'];
const rehearsalKey = 'chair-console:public-rehearsal:v1';
const host = document.getElementById('desk');
const isProjection = new URLSearchParams(location.search).has('screen');
let meeting;
let persistence = true;

function make(tag, text, parent) {
    const element = document.createElement(tag);
    if (text !== null) element.textContent = text;
    if (parent) parent.append(element);
    return element;
}

function readMeeting() {
    try {
        return JSON.parse(localStorage.getItem(rehearsalKey));
    } catch {
        return null;
    }
}

function update(note, change) {
    change(meeting);
    if (note) meeting.history.unshift(note);
    try {
        localStorage.setItem(rehearsalKey, JSON.stringify(meeting));
    } catch {
        persistence = false;
    }
    render();
}

function begin(mode) {
    meeting = {
        mode, phase: '点名', attendance: {}, queue: [], raised: [], sealed: false,
        nominated: null, speaker: null, motion: null, vote: null, history: [],
        timer: null, published: false,
    };
    update('开始' + mode + '彩排', () => {});
}

function button(parent, label, callback, {secondary = false, disabled = false} = {}) {
    const control = make('button', label, parent);
    control.type = 'button';
    control.classList.toggle('secondary', secondary);
    control.disabled = disabled;
    control.addEventListener('click', callback);
    return control;
}

function row(parent) {
    const container = make('div', null, parent);
    container.className = 'actions';
    return container;
}

function select(parent, title, options, current = '') {
    const label = make('label', title + '　', parent);
    const control = make('select', null, label);
    for (const value of options) {
        const option = make('option', value || '未登记', control);
        option.value = value;
    }
    control.value = current || options[0];
    return control;
}

function present() {
    return delegates.filter(name => meeting.attendance[name] === '出席');
}

function timer(kind, seconds) {
    return {kind, remaining: seconds, end: Date.now() + seconds * 1000};
}

function secondsLeft(clock) {
    if (!clock) return 0;
    return clock.end ? Math.max(0, Math.ceil((clock.end - Date.now()) / 1000)) : clock.remaining;
}

function clockText(clock) {
    const remaining = secondsLeft(clock);
    return Math.floor(remaining / 60) + ':' + String(remaining % 60).padStart(2, '0');
}

function rollCall(section) {
    make('h3', '登记出席', section);
    const list = make('ul', null, section);
    list.className = 'seats';
    for (const name of delegates) {
        const line = make('li', null, list);
        select(line, name, ['', '出席', '缺席'], meeting.attendance[name]).onchange = event => {
            const value = event.target.value;
            update(value ? name + '登记为' + value : null, state => { state.attendance[name] = value; });
        };
    }
    const controls = row(section);
    button(controls, '全部登记为出席', () => update('所有席位登记为出席', state => {
        for (const name of delegates) state.attendance[name] = '出席';
    }), {secondary: true});
    button(controls, '完成点名，进入辩论', () => {
        if (delegates.some(name => !meeting.attendance[name]) && !confirm('将未登记的席位记为缺席？')) return;
        update('完成点名', state => {
            for (const name of delegates) state.attendance[name] ||= '缺席';
            state.phase = '正式辩论';
        });
    }, {disabled: !present().length});
}

function debate(section) {
    const online = meeting.mode === '线上文字';
    if (online && !meeting.sealed) {
        make('h3', '举牌和本轮发言名单', section);
        const eligible = present().filter(name => !meeting.raised.includes(name));
        if (eligible.length) {
            const candidate = select(section, '举牌席位', eligible);
            button(section, '登记举牌', () => update(candidate.value + '举牌', state => state.raised.push(candidate.value)));
        }
        make('p', '已举牌 ' + (meeting.raised.join('、') || '暂无'), section);
        if (meeting.raised.length) {
            button(section, '公布本轮发言名单', () => update('已公布本轮发言名单', state => {
                state.queue = [...state.raised];
                state.sealed = true;
            }));
        }
    }
    if (!online) {
        make('h3', '主发言名单', section);
        const eligible = present().filter(name => !meeting.queue.includes(name) && name !== meeting.speaker);
        if (eligible.length) {
            const candidate = select(section, '准备发言', eligible);
            button(section, '加入发言名单', () => update(candidate.value + '加入发言名单', state => state.queue.push(candidate.value)));
        }
    }
    const controls = row(section);
    if (!meeting.speaker && meeting.queue.length) {
        button(controls, '点下一位', () => update('点出下一位发言人', state => {
            state.speaker = state.queue.shift();
            state.timer = online ? timer('等待开始', 120) : timer('发言计时', 60);
        }));
    }
    if (meeting.speaker && meeting.timer?.kind === '等待开始') {
        button(controls, '代表开始打字', () => update(meeting.speaker + '开始发言', state => {
            state.timer = timer('发言计时', 60);
        }));
    }
    if (meeting.speaker && meeting.timer?.kind === '发言计时') {
        button(controls, '发言完毕', () => update(meeting.speaker + '发言完毕', state => {
            state.timer = null;
            state.speaker = null;
        }));
    }
    if (online && meeting.sealed && !meeting.speaker && !meeting.queue.length) {
        button(controls, '开启新一轮举牌', () => update('开始新一轮举牌', state => {
            state.raised = [];
            state.sealed = false;
        }), {secondary: true});
    }
    if (!meeting.speaker) {
        make('h3', '提出动议', section);
        const mover = select(section, '提出席位', present());
        const type = select(section, '动议类型', ['有主持磋商', '结束辩论']);
        button(section, '登记动议', () => update(mover.value + '提出' + type.value, state => {
            state.motion = {kind: type.value, mover: mover.value, seconder: null};
            state.phase = '处理动议';
        }));
    }
}

function motions(section) {
    const motion = meeting.motion;
    make('h3', motion.kind, section);
    make('p', '提出席位 ' + motion.mover, section);
    if (!motion.seconder) {
        const eligible = present().filter(name => name !== motion.mover);
        if (eligible.length) {
            const candidate = select(section, '附议席位', eligible);
            button(section, '登记附议', () => update(candidate.value + '附议', state => {
                state.motion.seconder = candidate.value;
            }));
        } else {
            make('p', '本轮没有其他出席席位可附议。', section);
        }
    } else {
        make('p', '附议席位 ' + motion.seconder, section);
        button(section, '进入表决', () => update('进入表决 ' + motion.kind, state => {
            state.vote = {};
            state.phase = '表决';
        }));
    }
    button(row(section), '撤回动议', () => update('动议已撤回', state => {
        state.motion = null;
        state.phase = '正式辩论';
    }), {secondary: true});
}

function voting(section) {
    const members = present();
    const threshold = Math.floor(members.length / 2) + 1;
    make('h3', meeting.motion.kind + '表决', section);
    make('p', '本体验采用简单多数，需要至少 ' + threshold + ' 票赞成。', section);
    for (const name of members) {
        select(section, name, ['', '赞成', '反对', '弃权'], meeting.vote[name]).onchange = event => {
            const value = event.target.value;
            update(null, state => { state.vote[name] = value; });
        };
    }
    button(section, '确认表决结果', () => {
        const approved = members.filter(name => meeting.vote[name] === '赞成').length >= threshold;
        update((approved ? '表决通过 ' : '表决未通过 ') + meeting.motion.kind, state => {
            if (!approved) {
                state.phase = '正式辩论';
                state.motion = null;
            } else if (state.motion.kind === '结束辩论') {
                state.phase = '闭会确认';
            } else {
                state.phase = '有主持磋商';
                state.timer = timer('磋商计时', 180);
            }
            state.vote = null;
        });
    }, {disabled: members.some(name => !meeting.vote[name])});
}

function consultation(section) {
    const clock = meeting.timer;
    make('p', '体验时长为三分钟。', section);
    const controls = row(section);
    button(controls, clock.end ? '暂停计时' : '继续计时', () => update(null, state => {
        state.timer = clock.end
            ? {kind: clock.kind, remaining: secondsLeft(clock), end: null}
            : timer(clock.kind, clock.remaining);
    }), {secondary: true, disabled: !secondsLeft(clock)});
    button(controls, '结束磋商，返回辩论', () => update('磋商结束', state => {
        state.timer = null;
        state.motion = null;
        state.phase = '正式辩论';
    }));
}

function closing(section) {
    make('p', '请确认本轮会议已经结束。', section);
    const controls = row(section);
    button(controls, '确认闭会', () => update('会议闭会', state => {
        state.phase = '已闭会';
        state.motion = null;
    }));
    button(controls, '返回辩论', () => update('取消闭会', state => {
        state.phase = '正式辩论';
        state.motion = null;
    }), {secondary: true});
}

function dashboard(aside) {
    const state = make('section', null, aside);
    make('h2', meeting.mode + ' · ' + meeting.phase, state);
    make('p', '在场 ' + present().length + ' 席　发言 ' + (meeting.speaker || '—'), state);
    make('p', '待发言 ' + (meeting.queue.join('、') || '—'), state);
    make('p', meeting.timer?.kind || '计时', state).className = 'muted';
    make('div', clockText(meeting.timer), state).className = 'clock';
    button(row(state), meeting.published ? '暂停投影发布' : '发布到投影', () => update(null, current => {
        current.published = !current.published;
    }), {secondary: true});
    const projection = make('a', '打开本浏览器投影', state);
    projection.className = 'action secondary';
    projection.href = './?screen=1';
    projection.target = '_blank';
    projection.rel = 'noopener';

    const log = make('section', null, aside);
    make('h2', '最近记录', log);
    if (meeting.history.length) {
        const list = make('ol', null, log);
        for (const note of meeting.history.slice(0, 6)) make('li', note, list);
    } else {
        make('p', '等待主席操作。', log);
    }
}

function showProjection() {
    host.replaceChildren();
    const screen = make('section', null, host);
    screen.className = 'projection';
    if (!meeting?.published) {
        make('h2', '等待主席发布投影', screen);
        make('p', '请在同一个浏览器的主席台中发布。', screen);
        return;
    }
    make('h2', meeting.mode + ' · ' + meeting.phase, screen);
    make('div', clockText(meeting.timer), screen).className = 'clock';
    make('p', '发言 ' + (meeting.speaker || '—') + '　下一位 ' + (meeting.queue[0] || '—'), screen);
}

function render() {
    if (isProjection) { showProjection(); return; }
    host.replaceChildren();
    const layout = make('div', null, host);
    layout.className = 'layout';
    const section = make('section', null, layout);
    make('h2', '主持操作', section);
    if (!persistence) make('p', '浏览器拒绝了本地存储。请保持本标签页开启。', section);
    const views = {
        点名: rollCall, 正式辩论: debate, 处理动议: motions, 表决: voting,
        有主持磋商: consultation, 闭会确认: closing,
        已闭会: panel => make('p', '本轮彩排完成。', panel),
    };
    views[meeting.phase](section);
    const switcher = row(section);
    for (const mode of ['线下', '线上文字']) {
        button(switcher, '重新开始' + mode + '彩排', () => {
            if (confirm('清空本浏览器的当前彩排记录？')) begin(mode);
        }, {secondary: true});
    }
    const aside = make('aside', null, layout);
    aside.className = 'overview';
    dashboard(aside);
}

meeting = readMeeting();
if (isProjection || meeting) {
    render();
} else {
    const inperson = document.getElementById('begin-inperson');
    const online = document.getElementById('begin-online');
    inperson.disabled = false;
    online.disabled = false;
    inperson.addEventListener('click', () => begin('线下'));
    online.addEventListener('click', () => begin('线上文字'));
    document.getElementById('launch-status').textContent = '可以开始彩排。';
}

window.addEventListener('storage', event => {
    if (event.key !== rehearsalKey) return;
    meeting = readMeeting();
    if (isProjection || meeting) render();
});
setInterval(() => {
    if (!meeting?.timer) return;
    const expired = secondsLeft(meeting.timer) === 0;
    if (!isProjection && expired && meeting.timer.kind === '等待开始') {
        update(meeting.speaker + '等待超时，移至队尾', state => {
            state.queue.push(state.speaker);
            state.speaker = null;
            state.timer = null;
        });
        return;
    }
    for (const clock of document.querySelectorAll('.clock')) clock.textContent = clockText(meeting.timer);
}, 250);
