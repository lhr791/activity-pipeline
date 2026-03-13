const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType, HeadingLevel, BorderStyle, ShadingType } = require('docx');
const fs = require('fs');

const events = JSON.parse(fs.readFileSync('C:/Users/xtt/Desktop/ai 施工/events.json', 'utf8'));

// 交易所分类
const CATEGORIES = [
    {
        title: '🟢 开仓金 / 赠金类（亏损抵扣 0%）',
        exchanges: {
            'LBank': '开仓金 | 返佣30%',
            'Tapbit': '开仓金 | 返佣40%',
            'AscendEX': '超级赠金 | 返佣0%',
            'BitMart': '期货凭证/赠金 | 返佣60%',
            'WOOX Pro': '开仓金 | 返佣60%',
            'OrangeX': '奖励金 | 返佣55%',
        }
    },
    {
        title: '🟡 亏损抵扣 33~50%',
        exchanges: {
            'Toobit': '抵扣10% | 返佣50%',
            'XT': '抵扣20% | 返佣50%',
            'BTCC': '抵扣30% | 返佣50%',
            'VOOX': '抵扣30% | 返佣75%',
            'Zoomex': '抵扣30% | 返佣50%',
            'Deepcoin': '抵扣33% | 返佣60%',
            'Picol': '抵扣50% | 返佣0%',
            'OurBit': '抵扣50% | 返佣50%',
            'Phemex': '抵扣50% | 返佣50%',
            'FameEX': '抵扣50% | 返佣30%',
            'BYDFI': '抵扣50% | 返佣50%',
        }
    },
    {
        title: '🔴 亏损抵扣 100%',
        exchanges: {
            'Hotcoin': '返佣70%',
            'WEEX': '返佣70%',
            'Bitrue': '返佣48%',
        }
    },
    {
        title: '🔵 其他类型',
        exchanges: {
            'KuCoin': '返佣30%',
        }
    }
];

const NAME_MAP = {
    'ourbit': 'OurBit', 'zoomex': 'Zoomex', 'woox pro': 'WOOX Pro',
    'wooxpro': 'WOOX Pro', 'fameex': 'FameEX', 'bydfi': 'BYDFI',
    'btcc': 'BTCC', 'voox': 'VOOX', 'weex': 'WEEX', 'lbank': 'LBank',
    'tapbit': 'Tapbit', 'ascendex': 'AscendEX', 'bitmart': 'BitMart',
    'orangex': 'OrangeX', 'toobit': 'Toobit', 'xt': 'XT',
    'deepcoin': 'Deepcoin', 'picol': 'Picol', 'phemex': 'Phemex',
    'hotcoin': 'Hotcoin', 'bitrue': 'Bitrue', 'kucoin': 'KuCoin',
};

function normalize(name) {
    return NAME_MAP[name.toLowerCase().trim()] || name;
}

function parseDate(s) {
    if (!s || !s.trim()) return null;
    return new Date(s.trim().replace(' ', 'T'));
}

function eventStatus(ev) {
    const now = new Date('2026-03-04');
    const end = parseDate(ev.end_date);
    const start = parseDate(ev.start_date);
    if (end && end < now) return '已结束';
    if (start && start > now) return '未开始';
    return '进行中';
}

function makeRow(label, value) {
    if (!value || value === '—' || value === '-1' || value === '-1%' || value === '-1 USDT') return null;
    return new TableRow({
        children: [
            new TableCell({
                width: { size: 2000, type: WidthType.DXA },
                shading: { fill: 'E8E8E8', type: ShadingType.CLEAR },
                children: [new Paragraph({ children: [new TextRun({ text: label, bold: true, size: 18, font: 'Microsoft YaHei' })] })],
            }),
            new TableCell({
                width: { size: 7000, type: WidthType.DXA },
                children: [new Paragraph({ children: [new TextRun({ text: String(value), size: 18, font: 'Microsoft YaHei' })] })],
            }),
        ]
    });
}

function makeEventSection(ev, idx) {
    const status = eventStatus(ev);
    const emoji = status === '进行中' ? '✅' : (status === '未开始' ? '⏰' : '❌');
    const color = status === '进行中' ? '008000' : (status === '已结束' ? 'B40000' : 'C89600');

    const children = [];

    // Event title
    children.push(new Paragraph({
        spacing: { before: 200 },
        children: [
            new TextRun({ text: `活动 ${idx}: ${ev.event_name || '未知'}  `, bold: true, size: 22, font: 'Microsoft YaHei' }),
            new TextRun({ text: `[${emoji} ${status}]`, color: color, bold: true, size: 20, font: 'Microsoft YaHei' }),
        ]
    }));

    // Event details table
    const rows = [
        makeRow('活动类型', ev.type),
        makeRow('亏损抵扣', ev.loss_offset >= 0 ? `${ev.loss_offset}%` : null),
        makeRow('返佣比例', ev.commission_rate >= 0 ? `${ev.commission_rate}%` : null),
        makeRow('奖励详情', ev.reward),
        makeRow('参与条件', ev.requirements),
        makeRow('赠金类型', ev.bonus_type || null),
        makeRow('赠金有效期', ev.bonus_validity_days > 0 ? `${ev.bonus_validity_days}天` : null),
        makeRow('最低入金', ev.min_deposit > 0 ? `${ev.min_deposit} USDT` : null),
        makeRow('最高奖励', ev.max_reward > 0 ? `${ev.max_reward} USDT` : null),
        makeRow('交易量要求', ev.target_volume || null),
        makeRow('提现条件', ev.withdrawal_condition || null),
        makeRow('杠杆限制', ev.leverage_limit || null),
        makeRow('活动时间', (ev.start_date || ev.end_date) ? `${ev.start_date || '—'} ~ ${ev.end_date || '—'}` : null),
        makeRow('仅限新用户', ev.new_users_only ? '是' : '否'),
        makeRow('需要 KYC', ev.kyc_required === true ? '是' : (ev.kyc_required === false ? '否' : '未知')),
        makeRow('链接', ev.link || null),
        makeRow('避坑要点', ev.tips || null),
        makeRow('信息来源', ev.sources ? ev.sources.join(', ') : null),
    ].filter(Boolean);

    if (rows.length > 0) {
        children.push(new Table({
            width: { size: 9000, type: WidthType.DXA },
            rows: rows,
        }));
    }

    children.push(new Paragraph({ text: '' })); // spacing
    return children;
}

// Group events by exchange
const grouped = {};
events.forEach(ev => {
    const name = normalize(ev.exchange);
    if (!grouped[name]) grouped[name] = [];
    grouped[name].push(ev);
});

// Sort each group: active first, then expired
const statusOrder = { '进行中': 0, '未开始': 1, '已结束': 2 };
Object.values(grouped).forEach(arr => {
    arr.sort((a, b) => (statusOrder[eventStatus(a)] || 3) - (statusOrder[eventStatus(b)] || 3));
});

// Build document sections
const docChildren = [];

// Title
docChildren.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    heading: HeadingLevel.TITLE,
    children: [new TextRun({ text: '交易所活动整合报告', bold: true, size: 36, font: 'Microsoft YaHei' })],
}));

docChildren.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: '生成日期: 2026-03-04 | 数据来源: TG 活动频道监听', size: 18, color: '808080', font: 'Microsoft YaHei' })],
}));

// Stats
const activeCount = events.filter(e => eventStatus(e) === '进行中').length;
const expiredCount = events.filter(e => eventStatus(e) === '已结束').length;
const exchangeCount = Object.keys(grouped).length;

docChildren.push(new Paragraph({ text: '' }));
docChildren.push(new Paragraph({
    children: [new TextRun({ text: `📊 共收录 ${events.length} 个活动，涉及 ${exchangeCount} 个交易所`, bold: true, size: 22, font: 'Microsoft YaHei' })],
}));
docChildren.push(new Paragraph({
    children: [new TextRun({ text: `✅ 进行中: ${activeCount} | ❌ 已结束: ${expiredCount}`, size: 20, font: 'Microsoft YaHei' })],
}));
docChildren.push(new Paragraph({
    children: [new TextRun({ text: `⚠️ 注意：数据截止到 2026-02-25，部分活动可能已有更新。请以交易所官方页面为准。`, size: 18, color: 'B40000', font: 'Microsoft YaHei' })],
}));
docChildren.push(new Paragraph({ text: '' }));

// Each category
for (const cat of CATEGORIES) {
    docChildren.push(new Paragraph({
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 400 },
        children: [new TextRun({ text: cat.title, bold: true, size: 28, font: 'Microsoft YaHei' })],
    }));

    for (const [exName, exInfo] of Object.entries(cat.exchanges)) {
        docChildren.push(new Paragraph({
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 200 },
            children: [new TextRun({ text: `${exName}  (${exInfo})`, bold: true, size: 24, font: 'Microsoft YaHei' })],
        }));

        if (grouped[exName] && grouped[exName].length > 0) {
            let idx = 1;
            for (const ev of grouped[exName]) {
                docChildren.push(...makeEventSection(ev, idx++));
            }
        } else {
            docChildren.push(new Paragraph({
                children: [new TextRun({ text: '  ⚠️ 暂无活动数据（信息源未覆盖或尚未发布活动）', color: 'B48200', size: 18, font: 'Microsoft YaHei' })],
            }));
        }
    }
}

const doc = new Document({
    sections: [{
        properties: {},
        children: docChildren,
    }],
});

Packer.toBuffer(doc).then(buffer => {
    const outPath = 'C:/Users/xtt/Downloads/交易所活动整合报告.docx';
    fs.writeFileSync(outPath, buffer);
    console.log('✅ Word 文档已生成:', outPath);
});
