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
const mean = (arr) => arr.length === 0 ? 0 : arr.reduce((acc, val) => acc + val, 0) / arr.length;
const stdDev = (arr) => {
    if (arr.length < 2) return 0;
    const m = mean(arr);
    const avgSqDiff = mean(arr.map(val => (val - m) ** 2));
    return Math.sqrt(avgSqDiff);
};
const pearsonCorrelation = (x, y) => {
    if (!x || !y || x.length !== y.length || x.length < 2) return 0;
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
            pearsonCorrelation(s.scores.map(sc => sc.global), s.scores.map(sc => sc.total))
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
        <span class="font-bold" style="color: ${rColor}">${rText}</span>
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
        <span class="text-sm text-gray-500 ml-2">(${validRs.length} 筆有效場次)</span>
    `;
    overallAverageREl.classList.remove('animate-pulse');
}

function calculateAndSortExaminers(filteredExaminerData) {
    const dataArray = Object.values(filteredExaminerData).map(examiner => {
        const sessions = Object.values(examiner.sessions);
        const validRs = sessions.map(s => {
            return pearsonCorrelation(s.scores.map(sc => sc.global), s.scores.map(sc => sc.total));
        }).filter(r => !isNaN(r));
        
        const avgR = mean(validRs);
        return { ...examiner, avgR: avgR, sessionCount: sessions.length };
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
                    平均 $r = ${isNaN(avgR) ? 'N/A' : avgR.toFixed(3)}
                </span>
                <span class="ml-auto text-sm text-gray-500">${examiner.sessionCount} 場</span>
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

        button.innerHTML = `
            <div class="font-bold text-lg text-gray-800 truncate">${formatISODate(session.date)}</div>
            <div class="flex items-center mt-2">
                <span class="text-sm text-gray-500">${stationCount} 個考站</span>
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
    
    // 計算該場次考官效度統計
    const examinerStats = [];
    let totalExaminers = 0;
    let validExaminers = 0;
    let highValidityExaminers = 0;
    let needAttentionExaminers = [];
    
    Object.values(data.stations).forEach(station => {
        Object.values(station.examiners).forEach(examiner => {
            const xData = examiner.scores.map(s => s.global);
            const yData = examiner.scores.map(s => s.total);
            const r = pearsonCorrelation(xData, yData);
            
            totalExaminers++;
            examinerStats.push({
                name: examiner.name,
                department: examiner.department,
                station: station.station,
                r: r
            });
            
            if (!isNaN(r)) {
                validExaminers++;
                if (r >= 0.7) {
                    highValidityExaminers++;
                } else {
                    needAttentionExaminers.push({
                        name: examiner.name,
                        department: examiner.department,
                        station: station.station,
                        r: r
                    });
                }
            } else {
                needAttentionExaminers.push({
                    name: examiner.name,
                    department: examiner.department,
                    station: station.station,
                    r: r
                });
            }
        });
    });
    
    // 新增統計摘要區塊
    const stationsContainer = document.getElementById('sessionSummaryStations');
    stationsContainer.innerHTML = '';
    
    // 建立統計摘要卡片
    const summaryEl = document.createElement('div');
    summaryEl.className = 'bg-gradient-to-r from-blue-50 to-indigo-50 p-6 rounded-lg shadow-sm border border-blue-200 mb-6';
    
    const validityRate = validExaminers > 0 ? (highValidityExaminers / validExaminers * 100).toFixed(1) : 0;
    
    let summaryHtml = `
        <div class="flex items-center mb-4">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-blue-600 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            <h3 class="text-lg font-bold text-blue-800">該場次考官評核效度統計</h3>
        </div>
        
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div class="bg-white p-4 rounded-lg shadow-sm">
                <div class="text-2xl font-bold text-blue-600">${totalExaminers}</div>
                <div class="text-sm text-gray-600">總考官人次</div>
            </div>
            <div class="bg-white p-4 rounded-lg shadow-sm">
                <div class="text-2xl font-bold text-green-600">${highValidityExaminers}</div>
                <div class="text-sm text-gray-600">高效度 (r≥0.7) 人次</div>
            </div>
            <div class="bg-white p-4 rounded-lg shadow-sm">
                <div class="text-2xl font-bold ${validityRate >= 70 ? 'text-green-600' : validityRate >= 50 ? 'text-yellow-600' : 'text-red-600'}">${validityRate}%</div>
                <div class="text-sm text-gray-600">高效度比例</div>
            </div>
        </div>
    `;
    
    // 需關注考官列表
    if (needAttentionExaminers.length > 0) {
        summaryHtml += `
            <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                <h4 class="font-bold text-yellow-800 mb-2 flex items-center">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    需關注考官 (r&lt;0.7 或數據無效)
                </h4>
                <div class="space-y-2">
        `;
        
        needAttentionExaminers.forEach(examiner => {
            const rText = isNaN(examiner.r) ? 'N/A' : examiner.r.toFixed(3);
            const rColor = getRColor(examiner.r, 'hex');
            const statusText = isNaN(examiner.r) ? '數據無效' : getRText(examiner.r);
            
            summaryHtml += `
                <div class="flex justify-between items-center py-2 px-3 bg-white rounded border-l-4" style="border-left-color: ${rColor}">
                    <div>
                        <span class="font-medium text-gray-800">${examiner.name}</span>
                        <span class="ml-2 text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">${examiner.department}</span>
                        <span class="ml-2 text-xs bg-blue-100 text-blue-600 px-2 py-0.5 rounded">${examiner.station}</span>
                    </div>
                    <div class="text-right">
                        <div class="font-bold" style="color: ${rColor}">r = ${rText}</div>
                        <div class="text-xs text-gray-500">${statusText}</div>
                    </div>
                </div>
            `;
        });
        
        summaryHtml += `
                </div>
            </div>
        `;
    } else {
        summaryHtml += `
            <div class="bg-green-50 border border-green-200 rounded-lg p-4">
                <div class="flex items-center text-green-800">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span class="font-medium">優秀表現！所有考官效度均達標準 (r≥0.7)</span>
                </div>
            </div>
        `;
    }
    
    summaryEl.innerHTML = summaryHtml;
    stationsContainer.appendChild(summaryEl);

    const stations = Object.values(data.stations).sort((a,b) => a.station.localeCompare(b.station));

    stations.forEach(station => {
        const stationEl = document.createElement('div');
        stationEl.className = 'bg-white p-6 rounded-lg shadow';
        
        let examinerHtml = '';
        const examiners = Object.values(station.examiners).sort((a,b) => a.name.localeCompare(b.name));

        examiners.forEach(examiner => {
            const xData = examiner.scores.map(s => s.global);
            const yData = examiner.scores.map(s => s.total);
            const r = pearsonCorrelation(xData, yData);
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
                            r = ${isNaN(r) ? 'N/A' : r.toFixed(3)}
                        </span>
                    </div>
                </div>
            `;
        });

        stationEl.innerHTML = `
            <h3 class="text-xl font-bold text-blue-800 mb-3">${station.station}</h3>
            <div class="flow-root">${examinerHtml}</div>
        `;
        stationsContainer.appendChild(stationEl);
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
        const xData = session.scores.map(s => s.global);
        const yData = session.scores.map(s => s.total);
        const r = pearsonCorrelation(xData, yData);
        return {
            date: session.date,
            station: session.station,
            key: session.key,
            r: r, // (V15) 傳遞原始 r (可能為 NaN)
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
                <span class="text-sm font-medium ${textClass}">${statusText} (r=${isNaN(r) ? 'N/A' : r.toFixed(3)})</span>
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
    textEl.textContent = `(基於 ${validCount} 筆有效數據)`;

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
    // (V15) 數據：N/A 轉為 0，以便繪製在 Y 軸底部
    const chartData = trendData.map(d => isNaN(d.r) ? 0 : d.r); 

    trendChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: chartLabels,
            datasets: [{
                label: '相關係數 (r)',
                data: chartData, // (V15) 使用轉換後的數據
                fill: false,
                tension: 0.1, 
                spanGaps: true, // (V15) 連接 N/A (0) 的點
                pointRadius: 6,
                pointHoverRadius: 8,
                pointBackgroundColor: pointColors, // N/A 的點會是灰色
                pointBorderColor: 'rgba(255, 255, 255, 0.8)',
                pointBorderWidth: 1,
                
                // (V15) 新增：線條樣式 (N/A -> Valid 設為虛線)
                segment: {
                    borderColor: (ctx) => {
                        const p0 = trendData[ctx.p0DataIndex];
                        const p1 = trendData[ctx.p1DataIndex];
                        // 檢查前一個點或當前點是否為 N/A
                        if ((p0 && isNaN(p0.r)) || (p1 && isNaN(p1.r))) {
                            return 'rgba(156, 163, 175, 0.7)'; // 虛線使用灰色
                        }
                        return 'rgba(156, 163, 175, 0.5)'; // 預設實線顏色
                    },
                    borderDash: (ctx) => {
                        const p0 = trendData[ctx.p0DataIndex];
                        const p1 = trendData[ctx.p1DataIndex];
                        if ((p0 && isNaN(p0.r)) || (p1 && isNaN(p1.r))) {
                            return [6, 6]; // [虛線長度, 間隔長度]
                        }
                        return undefined; // 實線
                    }
                }
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { title: { display: true, text: '相關係數 (r)' }, min: 0, max: 1.0 },
                x: { title: { display: true, text: '評核場次 (依日期排序)' } }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        title: (context) => context[0].label,
                        label: (context) => `考站: ${trendData[context.dataIndex].station}`,
                        afterLabel: (context) => {
                            // (V15) 讀取原始 r 值來判斷
                            const originalR = trendData[context.dataIndex].r;
                            if (isNaN(originalR)) {
                                return 'r = N/A (數據無效)';
                            }
                            const r = context.parsed.y;
                            return `r = ${r.toFixed(3)} (${getRText(r)})`;
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
    const r = pearsonCorrelation(xData, yData);
    const sigmaX = stdDev(xData);
    const sigmaY = stdDev(yData);

    document.getElementById('detail_studentCount').textContent = `評核人數：${filteredScores.length} 人`;

    renderSessionKpis(r, sigmaX, sigmaY);
    
    renderSessionScatterPlot(filteredScores, r, passingScore);
    
    // (V17) 傳入 examinerData (用於 avgR 比較) -> 移除
    renderFeedback(r, sigmaX, sigmaY);
}


function renderSessionKpis(r, sigmaX, sigmaY) {
    const iconREl = document.getElementById('detail_kpi-r-icon');
    const valueREl = document.getElementById('detail_kpi-r-value');
    const textREl = document.getElementById('detail_kpi-r-text');
    const rText = getRText(r);

    if (isNaN(r) || sigmaX === 0) {
        iconREl.className = 'w-12 h-12 rounded-full flex items-center justify-center mr-4 bg-gray-500';
        iconREl.innerHTML = iconError;
        valueREl.textContent = 'N/A';
        textREl.textContent = '數據無效 (σX = 0)';
        textREl.className = 'text-sm font-medium text-gray-500';
    } else {
         const colorHex = getRColor(r, 'hex');
         iconREl.className = 'w-12 h-12 rounded-full flex items-center justify-center mr-4';
         iconREl.style.backgroundColor = colorHex;
         textREl.className = `text-sm font-medium`;
         textREl.style.color = colorHex;
         valueREl.textContent = r.toFixed(3);
         textREl.textContent = `${rText}`; 
         
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
    const rText = isNaN(r) ? 'N/A (數據無效)' : r.toFixed(3);
    
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
                    text: `相關係數 r = ${rText}`,
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
function renderFeedback(r, sigmaX, sigmaY) {
    const feedbackEl = document.getElementById('feedbackContent');
    feedbackEl.innerHTML = '';
    let problems = [], positives = [], suggestions = [];
    
    const bold = (text) => `<span class="font-bold">${text}</span>`;

    // --- r (效度) 分析 ---
    if (isNaN(r) || sigmaX === 0) {
        problems.push(`${bold('Global Rating 數據無效 (本場次)：')} 考官給予所有考生的「整體表現」分數均相同 ($\sigma_X = ${sigmaX.toFixed(2)}$)。這導致 $r$ 值無法計算，其數據${bold('無法')}用於標準設定。`);
        suggestions.push(`${bold('(最優先) 請使用 Global Rating 量尺：')} 考官的職責包含使用「整體表現」(X) 來標定考生的水平 (例如：不及格、及格邊緣、通過)。請務必將您在 Checklist (Y) 上觀察到的差異，同步反映在「整體表現」(X) 的評分上。`);
    } else if (r < 0.5) {
        problems.push(`${bold(`Global Rating 效度低 (r = ${r.toFixed(3)})：`)} 考官的「整體表現」(X) 判斷與其「總分」(Y) 評分存在${bold('顯著不一致')}。這可能代表考官對 Global Rating 的定義理解有誤，或評分時有 logique 矛盾。`);
        suggestions.push(`${bold('校準評分標準：')} 請重新檢視「整體表現」的評分標準。高總分 (Y) 的考生應獲得高整體表現 (X) 評分，反之亦然。`);
    } else if (r < 0.7) {
        problems.push(`${bold(`Global Rating 效度中等 (r = ${r.toFixed(3)})：`)} 考官的判斷與評分大致一致，但未達 0.7 的可信標準。`);
        suggestions.push(`${bold('提升一致性：')} 請在評分時確保「整體表現」能更精確地對應到「總分」的表現。`);
    } else {
        // (V17) 只有在 r >= 0.7 (有效且良好) 時才給予肯定
        positives.push(`${bold(`Global Rating 效度高 (r = ${r.toFixed(3)})：`)} 考官的「整體判斷」(X) 與「客觀評分」(Y) 高度相關，數據可信賴，可有效用於標準設定。`);
    }
    
    // --- Sigma (鑑別度) 分析 ---
    if (sigmaX > 0.5 && sigmaY > 1.0) {
        // (V17) 只有在鑑別度良好時才給予肯定
        positives.push(`${bold(`評分鑑別度良好 (σX=${sigmaX.toFixed(2)}, σY=${sigmaY.toFixed(2)})：`)} 考官能有效運用 Checklist (Y) 及 Global Rating (X) 量尺，區分出不同表現水平的考生。`);
    } else if (sigmaX === 0 && sigmaY > 1.0) {
        problems.push(`${bold('標準設定功能失效：')} 考官有能力在 Checklist (Y) 上區分學生 ($\sigma_Y = ${sigmaY.toFixed(2)}$)，但${bold('未能')}將此判斷反映在 Global Rating (X) 上 ($\sigma_X = ${sigmaX.toFixed(2)}$)。`);
    } else if (sigmaX < 0.5 || sigmaY < 1.0) {
        // (V17) 如果 sigmaX=0，這個 message 不應該和上面的「標準設定功能失效」同時出現
        if (sigmaX > 0) { 
            problems.push(`${bold('鑑別度可能偏低 (趨中誤差)：')} 考官給予的分數 (σY=${sigmaY.toFixed(2)}, σX=${sigmaX.toFixed(2)}) 相對集中，可能未能有效拉開高分群與低分群的差距。`);
            suggestions.push(`${bold('關於『鑑別度偏低』：')} 這是一個${bold('相對指標')}。請比較${bold('其他考官在同一站的 $\sigma_Y$ 值')}。
                <br> - 如果${bold('您的 $\sigma_Y$ 明顯低於同事')}，請嘗試放大評分量尺 (勇於給分)。
                <br> - 但如果${bold('所有考官的 $\sigma_Y$ 都很低')}，則可能代表此梯次考生程度確實相近。`);
        }
    }

    // --- (V17) 移除所有 "allRs.length" 相關的長期分析區塊 ---
    
    // --- 渲染 ---
    if (positives.length > 0) {
        const el = document.createElement('div');
        el.className = 'p-4 border-l-4 border-green-500 bg-green-50 rounded';
        el.innerHTML = `<h4 class="font-bold text-green-800 mb-2">肯定點 (Good Practice)</h4><ul class="list-disc pl-5 space-y-1 text-green-700">${positives.map(p => `<li>${p}</li>`).join('')}</ul>`;
        feedbackEl.appendChild(el);
    }
    if (problems.length > 0) {
        const el = document.createElement('div');
        el.className = 'p-4 border-l-4 border-red-500 bg-red-50 rounded';
        el.innerHTML = `<h4 class="font-bold text-red-800 mb-2">潛在問題點 (Issues)</h4><ul class="list-disc pl-5 space-y-1 text-red-700">${problems.map(p => `<li>${p}</li>`).join('')}</ul>`;
        feedbackEl.appendChild(el);
    }
    if (suggestions.length > 0) {
        const el = document.createElement('div');
        el.className = 'p-4 border-l-4 border-blue-500 bg-blue-50 rounded';
        el.innerHTML = `<h4 class="font-bold text-blue-800 mb-2">改善建議 (Suggestions)</h4><ul class="list-disc pl-5 space-y-1 text-blue-700">${suggestions.map(s => `<li>${s}</li>`).join('')}</ul>`;
        feedbackEl.appendChild(el);
    }

    // (V17) 如果完全沒有回饋 (例如 r=0.75, 但 sigma 很低)
    if (positives.length === 0 && problems.length === 0 && suggestions.length === 0) {
         const el = document.createElement('div');
        el.className = 'p-4 border-l-4 border-gray-500 bg-gray-50 rounded';
        el.innerHTML = `<h4 class="font-bold text-gray-800 mb-2">總結</h4><p class="text-gray-700">本次評核數據無明顯異常，但亦未達高度相關或鑑別度良好標準。</p>`;
        feedbackEl.appendChild(el);
    }
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
