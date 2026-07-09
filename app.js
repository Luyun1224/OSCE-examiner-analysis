// --- (V12) Google Apps Script 網址 ---
const WEB_APP_URL = "https://script.google.com/macros/s/AKfycbwaheMEsYWceyuaPRGHmvrA93EDjNEDYkFjUIAPDo9An-44uf9i2teVl8JaRJICUJPTCA/exec";

// --- (V16) 全局變數 (擴增) ---
let allExaminerData = {}; 
let allSessionSummaryData = {};
let allYears = [];
let allDepartments = [];
let allStudentTitles = [];
let lastSortedExaminerData = []; // (V16) 儲存排序後的考官數據
let currentView = 'examiner';
let currentYear = 'all';
let currentDept = 'all';
let currentSessionScores = []; 
let stationComparisonSort = { key: 'r', direction: 'asc' };
let stationComparisonLightFilter = 'all';


let trendChartInstance = null; 
let sessionChartInstance = null;
let rDistributionChartInstance = null; 

const COLORS = { BRIGHT_GREEN: '#10B981', GREEN: '#28a745', YELLOW: '#ffc107', ORANGE: '#F59E0B', RED: '#dc3545', GRAY: '#6c757d' };
const STATUS_CLASSES = { BRIGHT_GREEN: 'status-bright-green', GREEN: 'status-green', YELLOW: 'status-yellow', ORANGE: 'status-orange', RED: 'status-red', GRAY: 'status-gray' };

// --- (V16) DOM 元素 (擴增) ---
const examinerMasterListContainerEl = document.getElementById('examinerMasterListContainer');
const examinerMasterListEl = document.getElementById('examinerMasterList');
const examinerSearchInputEl = document.getElementById('examinerSearchInput'); // (V16) 新增
const sessionMasterListContainerEl = document.getElementById('sessionMasterListContainer');
const sessionMasterListEl = document.getElementById('sessionMasterList');
const loadingMessageEl = document.getElementById('loadingMessage');
const overallDashboardPageEl = document.getElementById('overallDashboardPage'); 
const examinerTrendPageEl = document.getElementById('examinerTrendPage');
const sessionSummaryPageEl = document.getElementById('sessionSummaryPage');
const sessionDetailPageEl = document.getElementById('sessionDetailPage');
const backButtonEl = document.getElementById('backButton');
const overallAverageREl = document.getElementById('overallAverageR');
const yearFilterEl = document.getElementById('yearFilter');
const deptFilterEl = document.getElementById('deptFilter');
const studentTitleFilterEl = document.getElementById('studentTitleFilter');
const studentTitleCountEl = document.getElementById('studentTitleCount');
const viewToggleExaminerEl = document.getElementById('viewToggleExaminer');
const viewToggleSessionEl = document.getElementById('viewToggleSession');
const homeButtonEl = document.getElementById('homeButton'); // (V18) 新增

// --- 輔助函數 (數學) ---
const mean = (arr) => arr.length === 0 ? NaN : arr.reduce((acc, val) => acc + val, 0) / arr.length;
const stdDev = (arr) => {
    if (arr.length < 2) return 0;
    const m = mean(arr);
    const avgSqDiff = mean(arr.map(val => (val - m) ** 2));
    return Math.sqrt(avgSqDiff);
};
const pearsonCorrelation = (x, y) => {
    if (!x || !y || x.length !== y.length || x.length < 3) return NaN;
    const n = x.length;
    const meanX = mean(x);
    const meanY = mean(y);
    if (stdDev(x) === 0 || stdDev(y) === 0) return NaN;
    let covariance = 0;
    for (let i = 0; i < n; i++) {
        covariance += (x[i] - meanX) * (y[i] - meanY);
    }
    covariance /= n;
    return covariance / (stdDev(x) * stdDev(y));
};

/**
 * (V25) 修正：日期格式化函數
 * 處理 Apps Script 傳來的 UTC 日期 (YYYY-MM-DD) 比 Tainan 日期 (YYYY/MM/DD) 少一天的問題。
 */
function formatISODate(isoDate) {
    if (!isoDate || isoDate === 'N/A') return 'N/A';
    try {
        // (V25) 檢查是否為完整 ISO T-String (e.g., ...T...Z)
        if (isoDate.includes('T') && isoDate.includes('Z')) {
            const date = new Date(isoDate);
            if (isNaN(date.getTime())) return isoDate; 
            
            // 情況 1: 完整 T-String (e.g., 7/22 16:00Z -> 7/23)
            // T-String (UTC) 轉 Tainan Time
            return date.toLocaleDateString('zh-TW', {
                timeZone: 'Asia/Taipei', // 強制使用台灣時区
                year: 'numeric',
                month: 'numeric',
                day: 'numeric'
            });
        } 
        
        // (V25) 處理 "YYYY-MM-DD" (假設為 UTC 日期)
        // e.g., Tainan 7/23 05:00 (UTC+8) = UTC 7/22 21:00
        // Apps Script 傳 "2025-07-22"
        // 我們需要顯示 "2025/7/23"
        
        let dateString = isoDate.split('T')[0]; // T-split 防呆
        const parts = dateString.split('-');
        
        if (parts.length === 3) {
            const [year, month, day] = parts.map(p => parseInt(p));
            if (!isNaN(year) && !isNaN(month) && !isNaN(day)) {
                
                // (V25) 關鍵修正：
                // `new Date(YYYY, MM-1, DD)` 建立 *本地* 日期
                // e.g., 2025, 6, 22 -> 7/22 (本地)
                const localDate = new Date(year, month - 1, day);
                
                // (V25) 假設這個日期是 UTC 日期，手動加 1 天
                localDate.setDate(localDate.getDate() + 1);
                
                // (V25) 格式化這個 *新* 日期 (7/23 本地)
                return localDate.toLocaleDateString('zh-TW', {
                    // 不指定 timeZone，使用本地時區
                    year: 'numeric',
                    month: 'numeric',
                    day: 'numeric'
                });
            }
        }
        
        return isoDate; // Fallback
    } catch (e) { return isoDate; }
}



function getRLight(r, n) {
    const validity = getSampleValidity(n);
    if (!validity.canCalculate || !Number.isFinite(r)) return 'gray';
    if (r >= 0.7) return 'green';
    if (r >= 0.5) return 'yellow';
    return 'red';
}

function getRLightLabel(light) {
    return ({ green: '綠燈', yellow: '黃燈', red: '紅燈', gray: '資料不足' })[light] || '全部';
}

function getRLightClass(light) {
    return ({
        green: 'bg-green-100 text-green-800 border-green-200',
        yellow: 'bg-yellow-100 text-yellow-800 border-yellow-200',
        red: 'bg-red-100 text-red-800 border-red-200',
        gray: 'bg-gray-100 text-gray-700 border-gray-200'
    })[light] || 'bg-gray-100 text-gray-700 border-gray-200';
}

function formatNumber(value, digits = 2) {
    return Number.isFinite(value) ? value.toFixed(digits) : 'N/A';
}

function calculatePassRate(scores = [], passingScore) {
    if (!scores.length || !Number.isFinite(Number(passingScore))) return NaN;
    const passCount = scores.filter(score => Number(score.total) >= Number(passingScore)).length;
    return passCount / scores.length;
}

function calculateStationExaminerComparisons(station) {
    const examiners = Object.values(station.examiners || {});
    const rows = examiners.map(examiner => {
        const scores = examiner.scores || [];
        const checklistScores = scores.map(score => Number(score.total)).filter(Number.isFinite);
        const globalRatings = scores.map(score => Number(score.global)).filter(Number.isFinite);
        const stat = calculateSessionR(scores);
        return {
            name: examiner.name,
            department: examiner.department,
            station: station.station,
            n: scores.length,
            r: stat.r,
            light: getRLight(stat.r, scores.length),
            avgChecklist: mean(checklistScores),
            avgGlobal: mean(globalRatings),
            sdChecklist: stdDev(checklistScores),
            sdGlobal: stdDev(globalRatings),
            passRate: calculatePassRate(scores, examiner.passingScore),
            insufficient: scores.length < 8 || !Number.isFinite(stat.r)
        };
    });

    const stationMeanChecklist = mean(rows.map(row => row.avgChecklist).filter(Number.isFinite));
    const stationSdChecklist = stdDev(rows.map(row => row.avgChecklist).filter(Number.isFinite));
    const fallbackThreshold = Math.abs(stationMeanChecklist) * 0.05;
    // 嚴格/寬鬆門檻：優先使用同站「各考官平均 Checklist Score」標準差的 0.5 倍；
    // 若同站差異太小或考官數不足，改用同站平均分數的 5%。未來可依院內共識調整 0.5 或 5%。
    const strictnessThreshold = Math.max(stationSdChecklist * 0.5, fallbackThreshold, 0.01);

    return rows.map(row => {
        let strictness = '接近平均';
        let strictnessClass = 'bg-gray-100 text-gray-700 border-gray-200';
        const diff = row.avgChecklist - stationMeanChecklist;
        if (Number.isFinite(diff) && diff < -strictnessThreshold) {
            strictness = '偏嚴';
            strictnessClass = 'bg-red-100 text-red-800 border-red-200';
        } else if (Number.isFinite(diff) && diff > strictnessThreshold) {
            strictness = '偏鬆';
            strictnessClass = 'bg-blue-100 text-blue-800 border-blue-200';
        }
        return { ...row, stationMeanChecklist, strictnessThreshold, strictness, strictnessClass };
    });
}

function renderStationComparisonTable(station) {
    let rows = calculateStationExaminerComparisons(station);
    if (stationComparisonLightFilter !== 'all') {
        rows = rows.filter(row => row.light === stationComparisonLightFilter);
    }

    const sortableColumns = [
        ['name', '考官姓名'], ['department', '科別'], ['station', '考站名稱'], ['n', '評核人數 n'],
        ['r', 'r 值'], ['avgChecklist', '平均 Checklist Score'], ['avgGlobal', '平均 Global Rating'],
        ['sdChecklist', 'Checklist SD'], ['sdGlobal', 'Global Rating SD'], ['passRate', '通過率'], ['strictness', '嚴格/寬鬆']
    ];
    const direction = stationComparisonSort.direction === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
        const key = stationComparisonSort.key;
        const aVal = a[key];
        const bVal = b[key];
        if (typeof aVal === 'number' || typeof bVal === 'number') {
            const av = Number.isFinite(aVal) ? aVal : -Infinity;
            const bv = Number.isFinite(bVal) ? bVal : -Infinity;
            return (av - bv) * direction;
        }
        return String(aVal || '').localeCompare(String(bVal || ''), 'zh-Hant') * direction;
    });

    const filterButtons = ['all', 'green', 'yellow', 'red'].map(light => `
        <button type="button" data-light-filter="${light}" class="station-light-filter px-3 py-1 rounded-full border text-sm ${stationComparisonLightFilter === light ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}">
            ${light === 'all' ? '全部燈號' : getRLightLabel(light)}
        </button>
    `).join('');

    const headers = sortableColumns.map(([key, label]) => {
        const arrow = stationComparisonSort.key === key ? (stationComparisonSort.direction === 'asc' ? ' ▲' : ' ▼') : '';
        return `<th scope="col" class="px-3 py-2 text-left whitespace-nowrap"><button type="button" data-sort-key="${key}" class="station-sort font-semibold hover:text-blue-700">${label}${arrow}</button></th>`;
    }).join('');

    const body = rows.length ? rows.map(row => `
        <tr class="border-t border-gray-100 hover:bg-gray-50">
            <td class="px-3 py-2 font-medium text-gray-900">${row.name}</td>
            <td class="px-3 py-2">${row.department || 'N/A'}</td>
            <td class="px-3 py-2">${row.station || 'N/A'}</td>
            <td class="px-3 py-2">${row.n}</td>
            <td class="px-3 py-2"><span class="status-dot ${getRColor(row.r, 'class')}"></span>${formatNumber(row.r, 3)}</td>
            <td class="px-3 py-2">${formatNumber(row.avgChecklist)}</td>
            <td class="px-3 py-2">${formatNumber(row.avgGlobal)}</td>
            <td class="px-3 py-2">${formatNumber(row.sdChecklist)}</td>
            <td class="px-3 py-2">${formatNumber(row.sdGlobal)}</td>
            <td class="px-3 py-2">${Number.isFinite(row.passRate) ? `${(row.passRate * 100).toFixed(1)}%` : 'N/A'}</td>
            <td class="px-3 py-2"><span class="inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${row.strictnessClass}">${row.strictness}</span></td>
        </tr>
        ${row.insufficient ? `<tr class="bg-orange-50 text-orange-800 text-xs"><td colspan="11" class="px-3 py-2">${row.name}：樣本不足，不建議解讀</td></tr>` : ''}
    `).join('') : `<tr><td colspan="11" class="px-3 py-6 text-center text-gray-500">無符合燈號篩選的考官。</td></tr>`;

    return `
        <div class="mt-5 border-t border-gray-200 pt-4">
            <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-3">
                <div>
                    <h4 class="text-lg font-bold text-gray-800">同站考官比較</h4>
                    <p class="text-xs text-gray-500">嚴格/寬鬆以考官平均 Checklist Score 與同站平均比較；差距超過門檻才標示偏嚴或偏鬆。</p>
                </div>
                <div class="flex flex-wrap gap-2">${filterButtons}</div>
            </div>
            <div class="overflow-x-auto">
                <table class="min-w-full text-sm text-gray-700 station-comparison-table">
                    <thead class="bg-gray-50 text-gray-600">${headers}</thead>
                    <tbody>${body}</tbody>
                </table>
            </div>
        </div>
    `;
}

function getSampleValidity(n) {
    if (n < 3) return { canCalculate: false, label: '樣本不足', className: 'text-red-600' };
    if (n < 8) return { canCalculate: true, label: '樣本數偏少，僅供參考', className: 'text-orange-600' };
    return { canCalculate: true, label: '有效樣本數充足', className: 'text-gray-500' };
}

function calculateSessionR(scores = []) {
    const n = scores.length;
    const validity = getSampleValidity(n);
    if (!validity.canCalculate) return { r: NaN, n, validity };
    return {
        r: pearsonCorrelation(scores.map(sc => sc.global), scores.map(sc => sc.total)),
        n,
        validity
    };
}

function formatRWithN(r, n) {
    const validity = getSampleValidity(n);
    const rText = Number.isFinite(r) ? r.toFixed(3) : 'N/A';
    return `r = ${rText}，n = ${n}${validity.label ? `，${validity.label}` : ''}`;
}

function getRValidityText(r, n) {
    const validity = getSampleValidity(n);
    if (!validity.canCalculate) return '樣本不足';
    if (!Number.isFinite(r)) return '資料無效或樣本不足';
    return validity.label;
}

function getRColor(r, type = 'hex') {
    if (isNaN(r)) return type === 'hex' ? COLORS.GRAY : STATUS_CLASSES.GRAY;
    if (r >= 0.9) return type === 'hex' ? COLORS.BRIGHT_GREEN : STATUS_CLASSES.BRIGHT_GREEN;
    if (r >= 0.7) return type === 'hex' ? COLORS.GREEN : STATUS_CLASSES.GREEN;
    if (r >= 0.5) return type === 'hex' ? COLORS.YELLOW : STATUS_CLASSES.YELLOW;
    if (r >= 0.3) return type === 'hex' ? COLORS.ORANGE : STATUS_CLASSES.ORANGE;
    return type === 'hex' ? COLORS.RED : STATUS_CLASSES.RED;
}
function getRText(r) {
    if (isNaN(r)) return '數據無效 (σ=0)';
    if (r >= 0.9) return '極高度相關';
    if (r >= 0.7) return '高度相關';
    if (r >= 0.5) return '中度相關';
    if (r >= 0.3) return '低度相關';
    return '缺乏相關';
}

// --- SVG 圖標 ---
const iconCheck = `<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>`;
const iconCheckBright = `<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>`;
const iconWarn = `<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>`;
const iconError = `<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" /></svg>`;
const iconDiscriminate = `<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7L3 3m0 0l4 4M3 3v4" /></svg>`;
const iconCentral = `<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5v4m0 0h-4m4 0l-5-5" /></svg>`;

// --- (V13) 核心功能 (重構) ---

/**
 * (V13) 顯示特定頁面
 */
function showPage(pageId) {
    overallDashboardPageEl.classList.add('hidden');
    examinerTrendPageEl.classList.add('hidden');
    sessionSummaryPageEl.classList.add('hidden');
    sessionDetailPageEl.classList.add('hidden');
    
    if (pageId === 'overallDashboard') overallDashboardPageEl.classList.remove('hidden');
    if (pageId === 'trend') examinerTrendPageEl.classList.remove('hidden');
    if (pageId === 'summary') sessionSummaryPageEl.classList.remove('hidden');
    if (pageId === 'detail') sessionDetailPageEl.classList.remove('hidden');
}

/**
 * (V12) 根據年份和科別篩選資料
 */
function getFilteredData(year, department) {
    const filteredExaminerData = {};
    const filteredSessionSummaryData = {};

    for (const examinerName in allExaminerData) {
        const examiner = allExaminerData[examinerName];
        if (department !== 'all' && examiner.department !== department) {
            continue;
        }
        const sessions = examiner.sessions;
        const filteredSessions = {};
        let sessionCount = 0;
        for (const key in sessions) {
            if (year === 'all' || sessions[key].date.startsWith(year)) {
                filteredSessions[key] = sessions[key];
                sessionCount++;
            }
        }
        if (sessionCount > 0) {
            filteredExaminerData[examinerName] = {
                ...examiner,
                sessions: filteredSessions
            };
        }
    }

    for (const date in allSessionSummaryData) {
        if (year !== 'all' && !date.startsWith(year)) {
            continue;
        }
        const stations = allSessionSummaryData[date].stations;
        const filteredStations = {};
        let stationCount = 0;
        for (const stationName in stations) {
            const examiners = stations[stationName].examiners;
            const filteredExaminers = {};
            let examinerCount = 0;
            for (const examinerName in examiners) {
                const examiner = examiners[examinerName];
                if (department === 'all' || examiner.department === department) {
                    filteredExaminers[examinerName] = examiner;
                    examinerCount++;
                }
            }
            if (examinerCount > 0) {
                filteredStations[stationName] = {
                    ...stations[stationName],
                    examiners: filteredExaminers
                };
                stationCount++;
            }
        }
        if (stationCount > 0) {
            filteredSessionSummaryData[date] = {
                ...allSessionSummaryData[date],
                stations: filteredStations
            };
        }
    }

    return { filteredExaminerData, filteredSessionSummaryData };
}

/**
 * (V13) 主渲染函數 (重構)
 */
function runAnalysisAndRender() {
    currentYear = yearFilterEl.value;
    currentDept = deptFilterEl.value;
    const { filteredExaminerData, filteredSessionSummaryData } = getFilteredData(currentYear, currentDept);
    
    const allSessionRs = Object.values(filteredExaminerData).flatMap(examiner => 
        Object.values(examiner.sessions).map(s => 
            calculateSessionR(s.scores).r
        )
    );
    
    renderOverallAverage(allSessionRs);

    const sortedExaminerData = calculateAndSortExaminers(filteredExaminerData);
    lastSortedExaminerData = sortedExaminerData; // (V16) 儲存排序後的數據

    if (currentView === 'examiner') {
        renderExaminerList(sortedExaminerData); // (V16) renderExaminerList 內部會處理搜尋過濾
        examinerMasterListContainerEl.classList.remove('hidden');
        sessionMasterListContainerEl.classList.add('hidden');
    } else {
        const sortedSessionData = Object.values(filteredSessionSummaryData)
            .sort((a, b) => b.date.localeCompare(a.date)); 
        renderSessionSummaryList(sortedSessionData);
        examinerMasterListContainerEl.classList.add('hidden');
        sessionMasterListContainerEl.classList.remove('hidden');
    }
    
    // (V20) 傳入 filteredSessionSummaryData
    renderOverallDashboard(sortedExaminerData, allSessionRs, filteredSessionSummaryData);
    
    showPage('overallDashboard');
}

/**
 * (V14) 渲染總覽儀表板 (修正 Top/Bottom 邏輯)
 * (V20) 修正：增加 filteredSessionSummaryData 參數
 */
function renderOverallDashboard(sortedExaminers, allSessionRs, filteredSessionSummaryData) {
    // 1. 更新標題
    let title = "總覽儀表板";
    if (currentYear !== 'all') title += ` (${currentYear}年)`;
    if (currentDept !== 'all') title += ` / ${currentDept}`;
    document.getElementById('overallDashboardTitle').textContent = title;

    // 2. 更新 KPIs
    const validRs = allSessionRs.filter(r => !isNaN(r));
    const avgR = mean(validRs);
    
    // (V20) 修正：計算 OSCE 場次 (依日期)
    const actualSessionCount = Object.keys(filteredSessionSummaryData).length;
    document.getElementById('overallKpiExaminerCount').textContent = actualSessionCount;
    // (V20) 修正：allSessionRs.length 實際上是「考官動用人次」
    document.getElementById('overallKpiSessionCount').textContent = allSessionRs.length;
    
    const kpiRAvgEl = document.getElementById('overallKpiAvgRValue');
    const kpiRAvgIconEl = document.getElementById('overallKpiAvgRIcon');
    kpiRAvgEl.textContent = isNaN(avgR) ? 'N/A' : avgR.toFixed(3);
    const avgRColorHex = getRColor(avgR, 'hex');
    kpiRAvgEl.style.color = avgRColorHex;
    kpiRAvgIconEl.className = 'w-12 h-12 rounded-full flex items-center justify-center';
    kpiRAvgIconEl.style.backgroundColor = avgRColorHex.replace(')', ', 0.1)').replace('rgb', 'rgba');
    
    if (isNaN(avgR)) {
        kpiRAvgIconEl.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="${COLORS.GRAY}"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>`;
    } else if (avgR >= 0.7) {
        kpiRAvgIconEl.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="${avgRColorHex}"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>`;
    } else {
        kpiRAvgIconEl.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="${avgRColorHex}"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>`;
    }

    // 3. (V14) 渲染 Top/Bottom 5 列表 (修正邏輯)
    const topListEl = document.getElementById('topExaminersList');
    const bottomListEl = document.getElementById('bottomExaminersList');
    topListEl.innerHTML = '';
    bottomListEl.innerHTML = '';

    // 篩選出 Top 5 (r >= 0.7)
    const topExaminers = sortedExaminers
        .filter(e => !isNaN(e.avgR) && e.avgR >= 0.7)
        .slice(0, 5);
    
    topExaminers.forEach(examiner => {
        topListEl.appendChild(createExaminerListItem(examiner));
    });
    if(topExaminers.length === 0) {
        topListEl.innerHTML = `<li class="text-sm text-gray-500">無 $r \ge 0.7$ 的考官</li>`;
    }

    // 篩選出 Bottom 5 (r < 0.7 或 NaN)，並從低排到高
    const bottomExaminers = sortedExaminers
        .filter(e => isNaN(e.avgR) || e.avgR < 0.7) // 取得所有需關注的
        .slice(-5) // 取得已排序 (高到低) 的最後 5 名 (即最差的 5 名)
        .reverse(); // 反轉，讓最差的 (r 最低) 在最上面
        
    bottomExaminers.forEach(examiner => {
        bottomListEl.appendChild(createExaminerListItem(examiner));
    });
    if(bottomExaminers.length === 0) {
        bottomListEl.innerHTML = `<li class="text-sm text-gray-500">無 $r < 0.7$ 的考官</li>`;
    }

    // 4. 計算分佈
    const dist = { 'bright-green': 0, 'green': 0, 'yellow': 0, 'orange': 0, 'red': 0, 'gray': 0 };
    allSessionRs.forEach(r => {
        const colorClass = getRColor(r, 'class');
        if (colorClass === STATUS_CLASSES.BRIGHT_GREEN) dist['bright-green']++;
        else if (colorClass === STATUS_CLASSES.GREEN) dist['green']++;
        else if (colorClass === STATUS_CLASSES.YELLOW) dist['yellow']++;
        else if (colorClass === STATUS_CLASSES.ORANGE) dist['orange']++;
        else if (colorClass === STATUS_CLASSES.RED) dist['red']++;
        else dist['gray']++;
    });
    
    renderRDistributionChart(dist);
}

/**
 * (V13) 新增：總覽列表項目
 */
function createExaminerListItem(examiner) {
    const li = document.createElement('li');
    li.className = 'flex justify-between items-center text-sm p-2 rounded hover:bg-gray-50';
    const avgR = examiner.avgR;
    const rText = isNaN(avgR) ? 'N/A' : avgR.toFixed(3);
    const rColor = getRColor(avgR, 'hex');
    li.innerHTML = `
        <div>
            <span class="font-medium text-gray-800">${examiner.name}</span>
            <span class="text-xs text-gray-500 ml-1">(${examiner.department})</span>
        </div>
        <span class="font-bold" style="color: ${rColor}">${rText} <span class="text-xs text-gray-500">(n=${examiner.totalN})</span></span>
    `;
    return li;
}

/**
 * (V13) 新增：渲染 $r$ 分佈直方圖
 */
function renderRDistributionChart(distData) {
    const ctx = document.getElementById('rDistributionChart').getContext('2d');
    if (rDistributionChartInstance) rDistributionChartInstance.destroy();
    
    const data = {
        labels: ['極高度 (0.9+)', '高度 (0.7-0.9)', '中度 (0.5-0.7)', '低度 (0.3-0.5)', '缺乏 (<0.3)', '無效'],
        datasets: [{
            label: '動用人次',
            data: [
                distData['bright-green'],
                distData['green'],
                distData['yellow'],
                distData['orange'],
                distData['red'],
                distData['gray']
            ],
            backgroundColor: [
                COLORS.BRIGHT_GREEN,
                COLORS.GREEN,
                COLORS.YELLOW,
                COLORS.ORANGE,
                COLORS.RED,
                COLORS.GRAY
            ],
            borderColor: 'rgba(255, 255, 255, 0.5)',
            borderWidth: 1
        }]
    };

    rDistributionChartInstance = new Chart(ctx, {
        type: 'bar',
        data: data,
        options: {
            responsive: true,
            maintainAspectRatio: false,
            indexAxis: 'y', // 橫向柱狀圖
            scales: {
                x: {
                    beginAtZero: true,
                    title: { display: true, text: '動用人次' },
                    ticks: {
                        // (V14) 確保 X 軸為整數
                        stepSize: 1, 
                        callback: function(value) { if (Number.isInteger(value)) { return value; } }
                    }
                },
                y: {
                    grid: { display: false }
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (context) => ` ${context.raw} 人次`
                    }
                }
            }
        }
    });
}


/**
 * (V12) 渲染篩選器 (年份和科別)
 */
function renderFilters() {
    allYears.forEach(year => {
        const option = document.createElement('option');
        option.value = year;
        option.textContent = `${year} 年`;
        yearFilterEl.appendChild(option);
    });
    allDepartments.forEach(dept => {
        const option = document.createElement('option');
        option.value = dept;
        option.textContent = dept;
        deptFilterEl.appendChild(option);
    });
    
    yearFilterEl.addEventListener('change', runAnalysisAndRender);
    deptFilterEl.addEventListener('change', runAnalysisAndRender);
}

/**
 * (V13) 渲染全體平均 R 值 (使用計算好的 R 列表)
 */
function renderOverallAverage(allSessionRs) {
     const validRs = allSessionRs.filter(r => !isNaN(r));
     const overallAvg = mean(validRs);
     const colorHex = getRColor(overallAvg, 'hex');
    
    overallAverageREl.innerHTML = `
        <div class="text-sm font-medium text-gray-500 mr-2">全體平均效度:</div>
        <span class="text-2xl font-bold" style="color: ${colorHex}">${isNaN(overallAvg) ? 'N/A' : overallAvg.toFixed(3)}</span>
        <span class="text-sm text-gray-500 ml-2">(n = ${validRs.length} 筆有效場次)</span>
    `;
    overallAverageREl.classList.remove('animate-pulse');
}

function calculateAndSortExaminers(filteredExaminerData) {
    const dataArray = Object.values(filteredExaminerData).map(examiner => {
        const sessions = Object.values(examiner.sessions);
        const sessionStats = sessions.map(s => calculateSessionR(s.scores));
        const validRs = sessionStats.map(stat => stat.r).filter(r => Number.isFinite(r));
        const avgR = mean(validRs);
        const totalN = sessionStats.reduce((sum, stat) => sum + stat.n, 0);
        return { ...examiner, avgR: avgR, sessionCount: sessions.length, validSessionCount: validRs.length, totalN };
    });
    
    dataArray.sort((a, b) => {
        const rA = isNaN(a.avgR) ? -1 : a.avgR;
        const rB = isNaN(b.avgR) ? -1 : b.avgR;
        return rB - rA;
    });
    
    return dataArray;
}

/**
 * (V16) 渲染考官列表 (新增搜尋過濾)
 */
function renderExaminerList(sortedData) {
    examinerMasterListEl.innerHTML = '';
    
    // (V16) 獲取搜尋關鍵字
    const searchTerm = examinerSearchInputEl.value.toLowerCase();
    
    // (V16) 過濾數據
    const filteredData = sortedData.filter(examiner => 
        examiner.name.toLowerCase().includes(searchTerm)
    );

    if (filteredData.length === 0) {
        examinerMasterListEl.innerHTML = `<div class="text-center text-gray-500 py-10">無符合條件的考官。</div>`;
        return;
    }

    filteredData.forEach(examiner => {
        const button = document.createElement('button');
        button.className = `w-full text-left p-4 rounded-lg border border-gray-200 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors duration-150`;
        button.dataset.key = examiner.name;
        
        const avgR = examiner.avgR;
        let statusClass = getRColor(avgR, 'class');
        let textClass = statusClass.replace('status-', 'text-');

        button.innerHTML = `
            <div class="flex justify-between items-start">
                <span class="font-bold text-lg text-gray-800 truncate">${examiner.name}</span>
                <span class="text-xs font-medium text-white bg-blue-500 px-2 py-0.5 rounded-full">${examiner.department}</span>
            </div>
            <div class="flex items-center mt-2">
                <span class="status-dot ${statusClass}"></span>
                <span class="text-sm font-medium ${textClass}">
                    平均 $r = ${isNaN(avgR) ? 'N/A' : avgR.toFixed(3)}，n = ${examiner.totalN}
                </span>
                <span class="ml-auto text-sm text-gray-500">${examiner.sessionCount} 場 / ${examiner.validSessionCount} 有效</span>
            </div>
        `;
        button.addEventListener('click', () => {
            document.querySelectorAll('#examinerMasterList button, #sessionMasterList button').forEach(btn => {
                btn.classList.remove('ring-2', 'ring-blue-500', 'ring-opacity-50', 'bg-blue-50');
            });
            button.classList.add('ring-2', 'ring-blue-500', 'ring-opacity-50', 'bg-blue-50');
            
            loadExaminerTrendPage(examiner.name);
        });
        examinerMasterListEl.appendChild(button);
    });
}

function renderSessionSummaryList(sortedData) {
    sessionMasterListEl.innerHTML = '';

    if (sortedData.length === 0) {
        sessionMasterListEl.innerHTML = `<div class="text-center text-gray-500 py-10">無符合條件的數據。</div>`;
        return;
    }

    sortedData.forEach(session => {
        const button = document.createElement('button');
        button.className = `w-full text-left p-4 rounded-lg border border-gray-200 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors duration-150`;
        button.dataset.key = session.date;

        const stationCount = Object.keys(session.stations).length;
        const sessionStats = Object.values(session.stations).flatMap(station =>
            Object.values(station.examiners).map(examiner => calculateSessionR(examiner.scores))
        );
        const validRs = sessionStats.map(stat => stat.r).filter(r => Number.isFinite(r));
        const avgR = mean(validRs);
        const totalN = sessionStats.reduce((sum, stat) => sum + stat.n, 0);
        const rColor = getRColor(avgR, 'hex');

        button.innerHTML = `
            <div class="font-bold text-lg text-gray-800 truncate">${formatISODate(session.date)}</div>
            <div class="flex items-center mt-2">
                <span class="text-sm text-gray-500">${stationCount} 個考站</span>
                <span class="ml-auto text-sm font-medium" style="color: ${rColor}">平均 r = ${isNaN(avgR) ? 'N/A' : avgR.toFixed(3)}，n = ${totalN}</span>
            </div>
        `;
        button.addEventListener('click', () => {
             document.querySelectorAll('#examinerMasterList button, #sessionMasterList button').forEach(btn => {
                btn.classList.remove('ring-2', 'ring-blue-500', 'ring-opacity-50', 'bg-blue-50');
            });
            button.classList.add('ring-2', 'ring-blue-500', 'ring-opacity-50', 'bg-blue-50');
            
            loadSessionSummaryPage(session.date);
        });
        sessionMasterListEl.appendChild(button);
    });
}

function loadSessionSummaryPage(date) {
    const { filteredSessionSummaryData } = getFilteredData(currentYear, currentDept);
    const data = filteredSessionSummaryData[date];
    if (!data) return;

    showPage('summary');

    document.getElementById('summary_date').textContent = `${formatISODate(date)} 評核概況`;
    const stationsContainer = document.getElementById('sessionSummaryStations');
    stationsContainer.innerHTML = '';

    const stations = Object.values(data.stations).sort((a,b) => a.station.localeCompare(b.station));

    stations.forEach(station => {
        const stationEl = document.createElement('div');
        stationEl.className = 'bg-white p-6 rounded-lg shadow';
        
        let examinerHtml = '';
        const examiners = Object.values(station.examiners).sort((a,b) => a.name.localeCompare(b.name));

        examiners.forEach(examiner => {
            const stat = calculateSessionR(examiner.scores);
            const r = stat.r;
            const statusClass = getRColor(r, 'class');
            const textClass = statusClass.replace('status-', 'text-');

            examinerHtml += `
                <div class="flex justify-between items-center py-3 border-b border-gray-100 last:border-b-0">
                    <div>
                        <span class="font-medium text-gray-700">${examiner.name}</span>
                        <span class="ml-2 text-xs font-medium text-white bg-blue-500 px-2 py-0.5 rounded-full">${examiner.department}</span>
                    </div>
                    <div class="flex items-center">
                        <span class="status-dot ${statusClass}"></span>
                        <span class="text-sm font-medium ${textClass}">
                            ${formatRWithN(r, stat.n)}
                        </span>
                    </div>
                </div>
            `;
        });

        stationEl.innerHTML = `
            <h3 class="text-xl font-bold text-blue-800 mb-3">${station.station}</h3>
            <div class="flow-root">${examinerHtml}</div>
            ${renderStationComparisonTable(station)}
        `;
        stationsContainer.appendChild(stationEl);

        stationEl.querySelectorAll('.station-sort').forEach(button => {
            button.addEventListener('click', () => {
                const key = button.dataset.sortKey;
                if (stationComparisonSort.key === key) {
                    stationComparisonSort.direction = stationComparisonSort.direction === 'asc' ? 'desc' : 'asc';
                } else {
                    stationComparisonSort = { key, direction: ['name', 'department', 'station', 'strictness'].includes(key) ? 'asc' : 'desc' };
                }
                loadSessionSummaryPage(date);
            });
        });
        stationEl.querySelectorAll('.station-light-filter').forEach(button => {
            button.addEventListener('click', () => {
                stationComparisonLightFilter = button.dataset.lightFilter;
                loadSessionSummaryPage(date);
            });
        });
    });
}

function loadExaminerTrendPage(examinerName) {
    const { filteredExaminerData } = getFilteredData(currentYear, currentDept);
    const data = filteredExaminerData[examinerName];
    if (!data) {
        showPage('overallDashboard');
        return;
    }
    
    showPage('trend');

    const sessionsArray = Object.values(data.sessions)
        .sort((a, b) => {
            const dateA = a.date === 'N/A' ? '9999' : a.date;
            const dateB = b.date === 'N/A' ? '9999' : b.date;
            return dateA.localeCompare(dateB);
        });

    const trendData = sessionsArray.map(session => {
        const stat = calculateSessionR(session.scores);
        const r = stat.r;
        return {
            date: session.date,
            station: session.station,
            key: session.key,
            r: r, // (V15) 傳遞原始 r (可能為 NaN)
            n: stat.n,
        };
    });
    
    document.getElementById('trend_examinerName').textContent = data.name;
    document.getElementById('trend_examinerDept').textContent = data.department;
    const validRs = trendData.map(d => d.r).filter(r => !isNaN(r));
    const avgR = mean(validRs);
    
    updateOverallKpiR(avgR, validRs.length);
    document.getElementById('trend_kpi_session_count').textContent = sessionsArray.length;
    let filterText = '有效數據';
    if (currentYear !== 'all') filterText = `${currentYear}年`;
    if (currentDept !== 'all') filterText = `${filterText} / ${currentDept}`;
    document.getElementById('trend_kpi_session_count_text').textContent = `場 (${filterText})`;

    renderTrendChart(trendData); // (V15) 傳遞包含 NaN 的 trendData

    const listEl = document.getElementById('sessionDrillDownList');
    listEl.innerHTML = '';
    trendData.forEach(session => {
        let r = session.r;
        let statusClass = getRColor(r, 'class');
        let textClass = statusClass.replace('status-', 'text-');
        let statusText = getRText(r);
        
        let buttonBgClass = 'border-gray-200 hover:bg-gray-50';
        if (isNaN(r) || r < 0.7) buttonBgClass = 'border-red-300 bg-red-50 hover:bg-red-100';
        if (r >= 0.9) buttonBgClass = 'border-green-300 bg-green-50 hover:bg-green-100';

        const button = document.createElement('button');
        button.className = `w-full text-left p-4 rounded-lg border ${buttonBgClass} focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors duration-150`;
        button.innerHTML = `
            <div class="flex justify-between items-center mb-1">
                <span class="font-bold text-lg text-gray-800 truncate">${session.station}</span>
                <span class="text-sm font-medium text-gray-600">${formatISODate(session.date)}</span>
            </div>
            <div class="flex items-center">
                <span class="status-dot ${statusClass}"></span>
                <span class="text-sm font-medium ${textClass}">${statusText} (${formatRWithN(r, session.n)})</span>
            </div>
        `;
        button.addEventListener('click', () => {
            loadSessionDetailPage(examinerName, session.key);
        });
        listEl.appendChild(button);
    });
}

function updateOverallKpiR(avgR, validCount) {
    const iconEl = document.getElementById('trend_kpi_r_icon');
    const valueEl = document.getElementById('trend_kpi_r_value');
    const textEl = document.getElementById('trend_kpi_r_text');
    
    valueEl.textContent = isNaN(avgR) ? 'N/A' : avgR.toFixed(3);
    textEl.textContent = `(n = ${validCount} 筆有效場次)`;

    if (isNaN(avgR)) {
        iconEl.className = 'w-12 h-12 rounded-full flex items-center justify-center mr-4 bg-gray-500';
        iconEl.innerHTML = iconError;
        textEl.className = 'text-sm font-medium text-gray-500';
    } else if (avgR >= 0.9) {
        iconEl.className = `w-12 h-12 rounded-full flex items-center justify-center mr-4 bg-bright-green`;
        iconEl.style.backgroundColor = COLORS.BRIGHT_GREEN;
        iconEl.innerHTML = iconCheckBright;
        textEl.className = 'text-sm font-medium';
        textEl.style.color = COLORS.BRIGHT_GREEN;
    } else if (avgR >= 0.7) {
        iconEl.className = 'w-12 h-12 rounded-full flex items-center justify-center mr-4 bg-green-500';
        iconEl.innerHTML = iconCheck;
        textEl.className = 'text-sm font-medium text-green-600';
    } else if (avgR >= 0.5) {
        iconEl.className = 'w-12 h-12 rounded-full flex items-center justify-center mr-4 bg-yellow-500';
        iconEl.innerHTML = iconWarn;
        textEl.className = 'text-sm font-medium text-yellow-600';
    } else {
        iconEl.className = 'w-12 h-12 rounded-full flex items-center justify-center mr-4 bg-red-500';
        iconEl.innerHTML = iconError;
        textEl.className = 'text-sm font-medium text-red-600';
    }
}

/**
 * (V15) 修正：渲染趨勢圖
 */
function renderTrendChart(trendData) {
    const ctx = document.getElementById('trendChart').getContext('2d');
    if (trendChartInstance) trendChartInstance.destroy();
    
    // (V15) 點的顏色： N/A 為灰色
    const pointColors = trendData.map(d => getRColor(d.r, 'hex'));
    const chartLabels = trendData.map(d => formatISODate(d.date));
    // N/A 使用 null 讓趨勢線中斷；另以灰色菱形標記在 N/A 輔助列，避免誤認為 r=0
    const chartData = trendData.map(d => Number.isFinite(d.r) ? d.r : null);
    const invalidPointData = trendData.map((d, index) => Number.isFinite(d.r) ? null : { x: chartLabels[index], y: -0.06, trendIndex: index });

    trendChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: chartLabels,
            datasets: [{
                label: '相關係數 (r)',
                data: chartData,
                fill: false,
                tension: 0.1, 
                spanGaps: false, // N/A 使用 null，不將無效點硬連線
                pointRadius: 6,
                pointHoverRadius: 8,
                pointBackgroundColor: pointColors,
                pointBorderColor: 'rgba(255, 255, 255, 0.8)',
                pointBorderWidth: 1,
                
                segment: {
                    borderColor: (ctx) => {
                        return 'rgba(156, 163, 175, 0.5)'; // 預設實線顏色
                    },
                    borderDash: (ctx) => {
                        return undefined; // N/A 為 null，Chart.js 不連線
                    }
                }
            }, {
                type: 'scatter',
                label: 'N/A（資料無效或樣本不足）',
                data: invalidPointData,
                showLine: false,
                pointRadius: 6,
                pointHoverRadius: 8,
                pointStyle: 'rectRot',
                pointBackgroundColor: COLORS.GRAY,
                pointBorderColor: 'rgba(255, 255, 255, 0.8)',
                pointBorderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    title: { display: true, text: '相關係數 (r)' },
                    min: -0.1,
                    max: 1.0,
                    ticks: {
                        callback: (value) => value < 0 ? 'N/A' : value
                    }
                },
                x: { title: { display: true, text: '評核場次 (依日期排序)' } }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        title: (context) => context[0].label,
                        label: (context) => {
                            const sourceIndex = context.dataset.type === 'scatter' ? context.raw.trendIndex : context.dataIndex;
                            return `考站: ${trendData[sourceIndex].station}`;
                        },
                        afterLabel: (context) => {
                            // (V15) 讀取原始 r 值來判斷
                            const sourceIndex = context.dataset.type === 'scatter' ? context.raw.trendIndex : context.dataIndex;
                            const originalR = trendData[sourceIndex].r;
                            if (isNaN(originalR)) {
                                return `r = N/A，n = ${trendData[sourceIndex].n}，資料無效或樣本不足`;
                            }
                            const r = context.parsed.y;
                            return `${formatRWithN(r, trendData[sourceIndex].n)} (${getRText(r)})`;
                        }
                    }
                }
            }
        }
    });
}

function loadSessionDetailPage(examinerName, sessionKey) {
    const examinerData = allExaminerData[examinerName];
    const sessionData = examinerData.sessions[sessionKey];
    if (!sessionData) return;
    
    showPage('detail');
    
    if (currentView === 'examiner') {
        // (V13)
        backButtonEl.onclick = () => {
            // 重新渲染考官列表和總覽，以防篩選有變
            runAnalysisAndRender(); 
            // 切換回趨勢頁
            loadExaminerTrendPage(examinerName);
        };
        backButtonEl.textContent = `← 返回 ${examinerName} 的趨勢圖`;
    } else {
        const sessionDate = sessionData.date;
         // (V13)
        backButtonEl.onclick = () => {
            // 重新渲染場次列表和總覽，以防篩選有變
            runAnalysisAndRender();
            // 切換回場次頁
            loadSessionSummaryPage(sessionDate);
        };
        backButtonEl.textContent = `← 返回 ${formatISODate(sessionDate)} 的場次總覽`;
    }
    
    const { name, station, maxScore, passingScore, scores, date } = sessionData;
    
    currentSessionScores = scores; 
    
    document.getElementById('detail_examinerName').textContent = name;
    document.getElementById('detail_stationName').textContent = station;
    document.getElementById('detail_scoreInfo').textContent = `滿分：${maxScore} / 及格：${passingScore}`;
    document.getElementById('detail_dateInfo').textContent = `評分日期：${formatISODate(date)}`; 
    document.getElementById('detail_examinerDept').textContent = examinerData.department;

    studentTitleFilterEl.innerHTML = '<option value="all">全部學員</option>';
    const uniqueTitles = [...new Set(scores.map(s => s.title))].sort();
    uniqueTitles.forEach(title => {
        const option = document.createElement('option');
        option.value = title;
        option.textContent = title;
        studentTitleFilterEl.appendChild(option);
    });
    studentTitleFilterEl.value = 'all'; 
    studentTitleFilterEl.onchange = () => {
        renderSessionDetailDynamicContent(sessionData, examinerData);
    };

    renderSessionDetailDynamicContent(sessionData, examinerData);
}

function renderSessionDetailDynamicContent(sessionData, examinerData) {
    const { name, station, maxScore, passingScore, scores, date } = sessionData;
    const currentTitleFilter = studentTitleFilterEl.value;
    
    const filteredScores = (currentTitleFilter === 'all')
        ? currentSessionScores 
        : currentSessionScores.filter(s => s.title === currentTitleFilter);
    
    studentTitleCountEl.textContent = `(共 ${filteredScores.length} / ${currentSessionScores.length} 人)`;

    const xData = filteredScores.map(s => s.global);
    const yData = filteredScores.map(s => s.total);
    const stat = calculateSessionR(filteredScores);
    const r = stat.r;
    const sigmaX = stdDev(xData);
    const sigmaY = stdDev(yData);

    document.getElementById('detail_studentCount').textContent = `評核人數：${filteredScores.length} 人`;

    renderSessionKpis(r, sigmaX, sigmaY, filteredScores.length);
    
    renderSessionScatterPlot(filteredScores, r, passingScore);
    
    // (V17) 傳入 examinerData (用於 avgR 比較) -> 移除
    renderFeedback(r, sigmaX, sigmaY, filteredScores.length, examinerData);
}


function renderSessionKpis(r, sigmaX, sigmaY, n) {
    const iconREl = document.getElementById('detail_kpi-r-icon');
    const valueREl = document.getElementById('detail_kpi-r-value');
    const textREl = document.getElementById('detail_kpi-r-text');
    const rText = getRText(r);

    if (isNaN(r) || sigmaX === 0) {
        iconREl.className = 'w-12 h-12 rounded-full flex items-center justify-center mr-4 bg-gray-500';
        iconREl.innerHTML = iconError;
        valueREl.textContent = 'N/A';
        textREl.textContent = `n = ${n}，${getRValidityText(r, n)}`;
        textREl.className = 'text-sm font-medium text-gray-500';
    } else {
         const colorHex = getRColor(r, 'hex');
         iconREl.className = 'w-12 h-12 rounded-full flex items-center justify-center mr-4';
         iconREl.style.backgroundColor = colorHex;
         textREl.className = `text-sm font-medium`;
         textREl.style.color = colorHex;
         valueREl.textContent = r.toFixed(3);
         textREl.textContent = `n = ${n}，${rText}，${getRValidityText(r, n)}`;
         
         if (r >= 0.9) iconREl.innerHTML = iconCheckBright;
         else if (r >= 0.7) iconREl.innerHTML = iconCheck;
         else if (r >= 0.5) iconREl.innerHTML = iconWarn;
         else iconREl.innerHTML = iconError;
    }
    
    const iconSigmaEl = document.getElementById('detail_kpi-sigma-icon');
    const valueYEl = document.getElementById('detail_kpi-sigma-y-value');
    const valueXEl = document.getElementById('detail_kpi-sigma-x-value');
    const textSigmaEl = document.getElementById('detail_kpi-sigma-text');
    
    valueYEl.textContent = `Y = ${sigmaY.toFixed(2)}`;
    valueXEl.textContent = `X = ${sigmaX.toFixed(2)}`;

    if (sigmaX > 0.5 && sigmaY > 1.0) {
        iconSigmaEl.className = 'w-12 h-12 rounded-full flex items-center justify-center mr-4 bg-blue-500';
        iconSigmaEl.innerHTML = iconDiscriminate;
        textSigmaEl.textContent = '具鑑別度 (能區分學生)';
        textSigmaEl.className = 'text-sm font-medium text-blue-600';
    } else if (sigmaX === 0 && sigmaY > 1.0) {
        iconSigmaEl.className = 'w-12 h-12 rounded-full flex items-center justify-center mr-4 bg-red-500';
        iconSigmaEl.innerHTML = iconCentral;
        textSigmaEl.textContent = '標準設定功能失效 (σX=0)';
        textSigmaEl.className = 'text-sm font-medium text-red-600';
    } else {
        iconSigmaEl.className = 'w-12 h-12 rounded-full flex items-center justify-center mr-4 bg-yellow-500';
        iconSigmaEl.innerHTML = iconCentral;
        textSigmaEl.textContent = '鑑別度可能偏低 (趨中)';
        textSigmaEl.className = 'text-sm font-medium text-yellow-600';
    }
}

function renderSessionScatterPlot(scores, r, passingScore) {
    const ctx = document.getElementById('correlationChart').getContext('2d');
    // *** FIX HERE ***
    // Was: const dataPoints = scores.map(s => ({ x: s.global, y s.total }));
    const dataPoints = scores.map(s => ({ x: s.global, y: s.total }));
    const rText = formatRWithN(r, scores.length);
    
    if (sessionChartInstance) sessionChartInstance.destroy();

    sessionChartInstance = new Chart(ctx, {
        type: 'scatter',
        data: {
            datasets: [{
                label: '考生評分 (X: 整體, Y: 總分)',
                data: dataPoints,
                backgroundColor: 'rgba(59, 130, 246, 0.7)',
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    title: { display: true, text: '整體表現 (Global Rating)', font: { size: 14 }},
                    min: 1, max: 5, ticks: { stepSize: 1, precision: 0 }
                },
                y: {
                    title: { display: true, text: '總分 (Checklist Score)', font: { size: 14 }},
                    beginAtZero: true
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (context) => {
                            if (!scores[context.dataIndex]) return '';
                            const score = scores[context.dataIndex];
                            const title = score.title || 'N/A';
                            return `${score.id} (${title}) - (X: ${score.global}, Y: ${score.total})`;
                        }
                    }
                },
                title: {
                    display: true,
                    text: `相關係數 ${rText}`,
                    font: { size: 16 },
                    color: '#333'
                }
            }
        },
        plugins: [{ 
            id: 'customLines',
            afterDraw: (chart) => {
                const ctx = chart.ctx;
                const yAxis = chart.scales.y;
                const yValue = yAxis.getPixelForValue(passingScore);
                if (yValue > yAxis.top && yValue < yAxis.bottom) {
                    ctx.save();
                    ctx.beginPath();
                    ctx.moveTo(chart.chartArea.left, yValue);
                    ctx.lineTo(chart.chartArea.right, yValue);
                    ctx.strokeStyle = 'rgba(239, 68, 68, 0.7)';
                    ctx.lineWidth = 2;
                    ctx.setLineDash([6, 6]);
                    ctx.stroke();
                    ctx.fillStyle = 'rgba(239, 68, 68, 0.7)';
                    ctx.font = '12px Inter';
                    ctx.fillText(`Y 及格線 = ${passingScore.toFixed(1)}`, chart.chartArea.left + 5, yValue - 5);
                    ctx.restore();
                }
            }
        }]
    });
}

/**
 * (V17) 修正：移除所有長期分析，只專注於當前場次的 r, sigmaX, sigmaY
 */
function getFeedbackPrescriptionLevel(r, sigmaX, sigmaY, n, examinerData) {
    const sessions = Object.values(examinerData?.sessions || {});
    const abnormalCount = sessions.filter(session => {
        const stat = calculateSessionR(session.scores || []);
        const globals = (session.scores || []).map(score => Number(score.global)).filter(Number.isFinite);
        const totals = (session.scores || []).map(score => Number(score.total)).filter(Number.isFinite);
        const sx = stdDev(globals);
        const sy = stdDev(totals);
        return (Number.isFinite(stat.r) && stat.r < 0.5) || sx === 0 || (sy > 1.0 && sx === 0);
    }).length;
    const consecutiveAbnormal = abnormalCount >= 2;

    if ((n >= 3 && Number.isFinite(r) && r < 0.5) || sigmaX === 0 || (sigmaY > 1.0 && sigmaX === 0) || consecutiveAbnormal) {
        return { level: 'red', label: '紅燈', consecutiveAbnormal };
    }
    if ((n >= 3 && Number.isFinite(r) && r >= 0.7) && n >= 8 && sigmaX > 0.5 && sigmaY > 1.0) {
        return { level: 'green', label: '綠燈', consecutiveAbnormal };
    }
    return { level: 'yellow', label: '黃燈', consecutiveAbnormal };
}

/**
 * 第三階段：將即時回饋升級為「考官改善處方箋」。
 * 分級邏輯刻意維持簡單透明：綠燈須同時達成 r、n、Global Rating/Checklist 變異；
 * 黃燈涵蓋中等 r、樣本偏少或評分過度集中；紅燈涵蓋低 r、Global Rating 無變異或疑似連續異常。
 */
function renderFeedback(r, sigmaX, sigmaY, n, examinerData) {
    const feedbackEl = document.getElementById('feedbackContent');
    feedbackEl.innerHTML = '';
    const prescription = getFeedbackPrescriptionLevel(r, sigmaX, sigmaY, n, examinerData);
    const rText = Number.isFinite(r) ? r.toFixed(3) : 'N/A';
    const sampleText = n < 3 ? '樣本不足，不建議解讀' : (n < 8 ? '樣本數偏少，僅供參考' : '樣本數足夠');

    const config = {
        green: {
            card: 'border-green-500 bg-green-50', title: 'text-green-800', body: 'text-green-700', badge: 'bg-green-600',
            heading: '綠燈：評分一致性良好',
            criteria: [
                `r = ${rText}（達 r ≥ 0.7）`,
                `${sampleText}`,
                `Global Rating SD = ${sigmaX.toFixed(2)}、Checklist Score SD = ${sigmaY.toFixed(2)}，兩者皆有適當變異`
            ],
            suggestions: ['評分一致性良好', '可作為穩定考官', '可持續參與 OSCE 評核']
        },
        yellow: {
            card: 'border-yellow-500 bg-yellow-50', title: 'text-yellow-800', body: 'text-yellow-800', badge: 'bg-yellow-500',
            heading: '黃燈：建議校準後持續追蹤',
            criteria: [
                `r = ${rText}（可能介於 0.5–0.7，或尚未達穩定綠燈條件）`,
                `${sampleText}`,
                `Global Rating SD = ${sigmaX.toFixed(2)}、Checklist Score SD = ${sigmaY.toFixed(2)}；若 SD 偏低代表評分使用可能過度集中`
            ],
            suggestions: ['建議下次評分前重新校準 Global Rating 錨點', '建議檢視是否有趨中評分傾向', '建議與同站考官進行評分標準討論']
        },
        red: {
            card: 'border-red-500 bg-red-50', title: 'text-red-800', body: 'text-red-700', badge: 'bg-red-600',
            heading: '紅燈：需優先介入回饋',
            criteria: [
                `r = ${rText}（若 r < 0.5 表示 Global Rating 與 Checklist Score 一致性不足）`,
                `Global Rating SD = ${sigmaX.toFixed(2)}${sigmaX === 0 ? '（完全無變異）' : ''}`,
                `Checklist Score SD = ${sigmaY.toFixed(2)}${sigmaY > 1.0 && sigmaX === 0 ? '；Checklist 有差異但 Global Rating 完全沒差異' : ''}`,
                prescription.consecutiveAbnormal ? '偵測到多場次異常，建議視為連續異常追蹤' : '未偵測到多場次異常訊號'
            ],
            suggestions: ['建議納入考官回饋', '建議安排評分標準再校準', '建議於下次 OSCE 前進行案例練習', '若連續異常，建議列入考官培訓追蹤名單']
        }
    }[prescription.level];

    feedbackEl.innerHTML = `
        <div class="p-4 border-l-4 rounded ${config.card}">
            <div class="flex items-start justify-between gap-3">
                <h4 class="font-bold ${config.title} mb-2">${config.heading}</h4>
                <span class="shrink-0 rounded-full px-3 py-1 text-xs font-bold text-white ${config.badge}">${prescription.label}</span>
            </div>
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 ${config.body}">
                <div>
                    <h5 class="font-semibold mb-1">判讀依據</h5>
                    <ul class="list-disc pl-5 space-y-1">${config.criteria.map(item => `<li>${item}</li>`).join('')}</ul>
                </div>
                <div>
                    <h5 class="font-semibold mb-1">改善處方箋</h5>
                    <ul class="list-disc pl-5 space-y-1">${config.suggestions.map(item => `<li>${item}</li>`).join('')}</ul>
                </div>
            </div>
            ${n < 8 ? '<p class="mt-3 text-sm font-medium text-orange-700">樣本不足，不建議解讀；建議累積更多評核資料後再做正式判斷。</p>' : ''}
        </div>
    `;
}

/**
 * (V12) 啟動應用程式 (全新)
 */
async function initApp() {
    try {
        const url = `${WEB_APP_URL}?t=${new Date().getTime()}`;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP 錯誤! 狀態: ${response.status}`);
        
        const data = await response.json();
        if (data.error) throw new Error(`Apps Script 錯誤: ${data.error}`);
        
        allExaminerData = data.examinerData || {};
        allSessionSummaryData = data.sessionSummaryData || {};
        allYears = data.years || [];
        allDepartments = data.departments || [];
        allStudentTitles = data.studentTitles || [];
        
        loadingMessageEl.classList.add('hidden');
        
        renderFilters();

        // (V1List) 新增搜尋框事件監聽
        examinerSearchInputEl.addEventListener('input', () => {
            // 只重新渲染考官列表，使用已儲存的排序數據
            renderExaminerList(lastSortedExaminerData);
        });
        
        // (V18) 新增：首頁按鈕事件監聽
        homeButtonEl.addEventListener('click', () => {
            // (V19) 修正：點擊首頁時，重置篩選器
            deptFilterEl.value = 'all';
            yearFilterEl.value = 'all';
            
            // runAnalysisAndRender() 函數會自動讀取重置後的值，並顯示總覽儀表板
            runAnalysisAndRender();
            
            // (V18) 重置列表的選取狀態
            document.querySelectorAll('#examinerMasterList button, #sessionMasterList button').forEach(btn => {
                btn.classList.remove('ring-2', 'ring-blue-500', 'ring-opacity-50', 'bg-blue-50');
            });
        });
        
        viewToggleExaminerEl.addEventListener('click', () => {
            currentView = 'examiner';
            viewToggleExaminerEl.classList.add('active');
            viewToggleSessionEl.classList.remove('active');
            runAnalysisAndRender();
        });
        viewToggleSessionEl.addEventListener('click', () => {
            currentView = 'session';
            viewToggleExaminerEl.classList.remove('active');
            viewToggleSessionEl.classList.add('active');
            runAnalysisAndRender();
        });

        runAnalysisAndRender();
        
    } catch (error) {
        console.error('載入數據失敗:', error);
        let errorHtml = `
            <svg xmlns="http://www.w3.org/2000/svg" class="h-10 w-10 text-red-500 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            <span class="font-bold text-red-600">載入數據失敗</span><br>
            <span class="text-sm text-gray-600">${error.message}</span>
            <div class="text-xs text-left text-gray-500 mt-4 p-3 bg-gray-50 rounded-lg">
                <span class="font-bold">【最可能的解決方法】</span><br>
                <p class="my-1">當您更新 Code.gs 並重新部署後，Google 會要求您重新授權。</p>
                <ol class="list-decimal list-inside space-y-1">
                    <li>請<span class="font-bold">在新分頁</span>中，<span class="font-bold">手動開啟</span>以下您的 Apps Script 部署網址：</li>
                    <li class="text-blue-600 break-all text-xs">${WEB_APP_URL.split('?')[0]}</li>
                    <li>Google 會要求您登入或點選「允許」/「進階」。</li>
                    <li>授權成功後 (您會看到純文字資料)，請關閉該分Y。</li>
                    <li>回到此儀表板，按 <span class="font-bold">Ctrl+Shift+R</span> 強制重新整理。</li>
                </ol>
                <hr class="my-2">
                <span class="font-bold">【其他檢查】</span><br>
                1. 確認 Apps Script 已部署為「任何人」皆可存取。<br>
                2. 確認您的 Google Sheet 分頁名稱為 "${SHEET_NAME}"。
            </div>
        `;
        loadingMessageEl.innerHTML = errorHtml;
    }
}

// --- 程式進入點 ---
document.addEventListener('DOMContentLoaded', initApp);
