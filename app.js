// === СТРОГИЙ РЕЖИМ ===
'use strict';

// === КОНФИГУРАЦИЯ FIREBASE ===
let firebaseInitialized = false;
try {
    if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length > 0) {
        firebaseInitialized = true;
        console.log('Firebase уже инициализирован');
    }
} catch (error) {
    console.warn('Firebase не загружен:', error);
}

// === ПЕРЕМЕННЫЕ FIREBASE ===
let db;
let auth;
let currentUser = null;
let usersRef;
let dealsRef;
let ordersRef;
let gamesRef;
let projectsRef;
let notificationsRef;
let cryptoRef;
let withdrawalsRef;

// === ОСНОВНОЙ ОБЪЕКТ ПЛАТФОРМЫ ===
const platform = {
    balance: 0,
    pendingProfit: 0,
    userData: {},
    cryptoPrices: {},
    projects: {},
    deals: [],
    orders: [],
    notifications: [],
    casinoGames: {},
    portfolio: {
        dogemoon: 0,
        pepe: 0,
        shiba: 0,
        bonk: 0,
        floki: 0
    },
    tempData: {
        isOnline: false,
        lastUpdate: Date.now(),
        animationQueue: [],
        selectedCoin: 'dogemoon',
        currentInvestProject: 'millennium-tower',
        partialDeal: null,
        wheelGame: {
            roundEnd: Date.now() + 60000,
            players: [],
            totalBet: 0,
            prizePool: 0,
            timerInterval: null,
            spinAnimation: false,
            spinAngle: 0,
            winnerIndex: -1
        }
    },
    nextPayoutDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
};

// === КОНСТАНТЫ ===
const SKY_TO_USD = 0.001;
const USD_TO_SKY = 800;
const PROJECT_TOTAL_SHARES = 1000000;
const PROJECT_MONTHLY_PROFIT = 20000000;

// ================== TELEGRAM WEB APP ==================
function initTelegramWebApp() {
    try {
        if (!window.Telegram || !Telegram.WebApp) {
            console.warn('Telegram WebApp не обнаружен');
            return false;
        }

        const tg = Telegram.WebApp;
        tg.expand();
        tg.ready();

        const theme = tg.colorScheme;
        document.documentElement.setAttribute('data-theme', theme);

        if (tg.MainButton) {
            tg.MainButton.setText('Пополнить баланс');
            tg.MainButton.onClick(() => openDepositModal());
            tg.MainButton.show();
        }

        if (tg.BackButton) {
            tg.BackButton.onClick(() => {
                showSection('home');
                tg.BackButton.hide();
            });
        }

        console.log('Telegram WebApp инициализирован');
        return true;
    } catch (error) {
        console.error('Ошибка инициализации Telegram WebApp:', error);
        return false;
    }
}

// ================== ИНИЦИАЛИЗАЦИЯ ПЛАТФОРМЫ ==================
async function initPlatform() {
    try {
        console.log("Начало инициализации платформы...");

        initTelegramWebApp();

        if (!firebaseInitialized) {
            console.warn("Firebase не инициализирован, используем оффлайн-режим");
            return initPlatformOffline();
        }

        try {
            db = firebase.firestore();
            auth = firebase.auth();

            usersRef = db.collection("users");
            dealsRef = db.collection("deals");
            ordersRef = db.collection("orders");
            gamesRef = db.collection("games");
            projectsRef = db.collection("projects");
            notificationsRef = db.collection("notifications");
            cryptoRef = db.collection("crypto");
            withdrawalsRef = db.collection("withdrawals");

            console.log("Firebase сервисы готовы");
        } catch (firebaseError) {
            console.error("Ошибка Firebase:", firebaseError);
            return initPlatformOffline();
        }

        try {
            await initAuth();
        } catch (authError) {
            console.error("Ошибка авторизации:", authError);
            return initPlatformOffline();
        }

        try {
            await loadInitialData();
        } catch (dataError) {
            console.error("Ошибка загрузки данных:", dataError);
        }

        try {
            setupRealtimeUpdates();
        } catch (updateError) {
            console.error("Ошибка настройки обновлений:", updateError);
        }

        initUI();
        hideLoading();
        console.log("Платформа успешно инициализирована");

        startPayoutTimer();
        initAdStats();
        checkAndResetAdCounter();

        updateNotificationBadge(0);

    } catch (error) {
        console.error("Критическая ошибка инициализации:", error);
        hideLoading();
        showError("Ошибка загрузки. Переход в оффлайн-режим");
        setTimeout(() => initPlatformOffline(), 1000);
    }
}

// ================== АВТОРИЗАЦИЯ ==================
async function initAuth() {
    try {
        if (window.Telegram && Telegram.WebApp && Telegram.WebApp.initDataUnsafe?.user) {
            const tgUser = Telegram.WebApp.initDataUnsafe.user;
            const userId = `tg_${tgUser.id}`;

            try {
                const credential = await auth.signInAnonymously();
                currentUser = credential.user;

                await usersRef.doc(userId).set({
                    id: userId,
                    telegramId: tgUser.id,
                    username: tgUser.username || `user_${tgUser.id}`,
                    firstName: tgUser.first_name,
                    lastName: tgUser.last_name,
                    photoUrl: tgUser.photo_url,
                    balance: 1000,
                    portfolio: platform.portfolio,
                    projectShares: { 'millennium-tower': 0 },
                    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                    lastSeen: firebase.firestore.FieldValue.serverTimestamp(),
                    online: true
                }, { merge: true });

                currentUser.uid = userId;
            } catch (tgAuthError) {
                console.warn("Ошибка Telegram авторизации, используем анонимный вход:", tgAuthError);
                await initAnonymousAuth();
            }
        } else {
            await initAnonymousAuth();
        }

        setUserOnline(true);

    } catch (error) {
        console.error("Ошибка авторизации:", error);
        throw error;
    }
}

async function initAnonymousAuth() {
    try {
        const credential = await auth.signInAnonymously();
        currentUser = credential.user;

        await usersRef.doc(currentUser.uid).set({
            id: currentUser.uid,
            username: `user_${Date.now()}`,
            balance: 1000,
            portfolio: platform.portfolio,
            projectShares: { 'millennium-tower': 0 },
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            lastSeen: firebase.firestore.FieldValue.serverTimestamp(),
            online: true
        }, { merge: true });
    } catch (error) {
        console.error("Ошибка анонимной авторизации:", error);
        throw error;
    }
}

// ================== ЗАГРУЗКА ДАННЫХ ==================
async function loadInitialData() {
    showLoading("Загрузка данных...");

    try {
        if (currentUser && usersRef) {
            const userDoc = await usersRef.doc(currentUser.uid).get();
            if (userDoc.exists) {
                platform.userData = userDoc.data();
                platform.balance = platform.userData.balance || 0;
                platform.portfolio = platform.userData.portfolio || platform.portfolio;
                if (!platform.userData.projectShares) {
                    platform.userData.projectShares = { 'millennium-tower': 0 };
                }
            }
        }

        if (projectsRef) {
            const projectsSnapshot = await projectsRef.get();
            if (projectsSnapshot.empty) {
                ensureDefaultProject();
            } else {
                projectsSnapshot.forEach(doc => {
                    const data = doc.data();
                    data.raised = data.raised || 0;
                    platform.projects[doc.id] = data;
                });
                ensureDefaultProject();
            }
        } else {
            ensureDefaultProject();
        }

        if (dealsRef) {
            const dealsSnapshot = await dealsRef.where('status', '==', 'active').limit(20).get();
            platform.deals = [];
            dealsSnapshot.forEach(doc => {
                platform.deals.push({ id: doc.id, ...doc.data() });
            });
        } else {
            platform.deals = getDemoDeals();
        }

        if (ordersRef) {
            const ordersSnapshot = await ordersRef.orderBy('timestamp', 'desc').limit(50).get();
            platform.orders = [];
            ordersSnapshot.forEach(doc => {
                platform.orders.push({ id: doc.id, ...doc.data() });
            });
        } else {
            platform.orders = getDemoOrders();
        }

        if (cryptoRef) {
            try {
                const cryptoSnapshot = await cryptoRef.doc('prices').get();
                if (cryptoSnapshot.exists) {
                    platform.cryptoPrices = cryptoSnapshot.data();
                } else {
                    platform.cryptoPrices = getDemoCryptoPrices();
                }
            } catch (cryptoError) {
                console.warn("Ошибка загрузки крипто-цен:", cryptoError);
                platform.cryptoPrices = getDemoCryptoPrices();
            }
        } else {
            platform.cryptoPrices = getDemoCryptoPrices();
        }

        if (notificationsRef && currentUser) {
            try {
                const notificationsSnapshot = await notificationsRef
                    .where('userId', '==', currentUser.uid)
                    .orderBy('timestamp', 'desc')
                    .limit(20)
                    .get();

                platform.notifications = [];
                notificationsSnapshot.forEach(doc => {
                    platform.notifications.push({ id: doc.id, ...doc.data() });
                });
            } catch (e) {
                console.warn("Не удалось загрузить уведомления. Используем демо.");
                platform.notifications = [];
            }
        } else {
            platform.notifications = [];
        }

        await loadWithdrawHistory();

        console.log("Данные успешно загружены");

    } catch (error) {
        console.error("Ошибка загрузки данных:", error);
        platform.balance = 10000;
        platform.userData = {
            username: "Гость",
            balance: 10000,
            projectShares: { 'millennium-tower': 0 }
        };
        platform.cryptoPrices = getDemoCryptoPrices();
        platform.deals = getDemoDeals();
        platform.orders = getDemoOrders();
        ensureDefaultProject();
    } finally {
        hideLoading();
    }
}

function ensureDefaultProject() {
    if (!platform.projects['millennium-tower']) {
        platform.projects['millennium-tower'] = {
            name: 'Башня Тысячелетия',
            target: 5500000000,
            raised: 0,
            yield: 8.3,
            duration: 15,
            exitYear: 2035,
            description: 'Самое высокое здание в мире (1100 м). Офисы, апартаменты, отель.',
            investors: 0
        };
    }
}

async function loadWithdrawHistory() {
    if (!withdrawalsRef || !currentUser) {
        const demoHistory = [
            { amount: 500, method: 'crypto', status: 'completed', timestamp: new Date(Date.now() - 86400000).toISOString() },
            { amount: 200, method: 'bank', status: 'pending', timestamp: new Date().toISOString() }
        ];
        updateWithdrawHistory(demoHistory);
        return;
    }
    try {
        const snapshot = await withdrawalsRef
            .where('userId', '==', currentUser.uid)
            .orderBy('timestamp', 'desc')
            .limit(20)
            .get();
        const history = [];
        snapshot.forEach(doc => history.push({ id: doc.id, ...doc.data() }));
        updateWithdrawHistory(history);
    } catch (error) {
        console.error("Ошибка загрузки истории выводов:", error);
        updateWithdrawHistory([]);
    }
}

// ================== REALTIME ОБНОВЛЕНИЯ ==================
function setupRealtimeUpdates() {
    if (!firebaseInitialized || !currentUser) return;

    try {
        if (usersRef) {
            usersRef.doc(currentUser.uid).onSnapshot((doc) => {
                if (doc.exists) {
                    const data = doc.data();
                    platform.balance = data.balance || 0;
                    platform.portfolio = data.portfolio || platform.portfolio;
                    platform.userData.projectShares = data.projectShares || { 'millennium-tower': 0 };
                    updateBalanceDisplay();
                    updatePortfolioDisplay();
                    updateProjectStats();
                }
            }, (error) => {
                console.error("Ошибка обновления баланса:", error);
            });
        }

        if (dealsRef) {
            dealsRef.where('status', '==', 'active').limit(20)
                .onSnapshot((snapshot) => {
                    platform.deals = [];
                    snapshot.forEach(doc => {
                        platform.deals.push({ id: doc.id, ...doc.data() });
                    });
                    updateDealsList();
                }, (error) => {
                    console.error("Ошибка обновления сделок:", error);
                });
        }

        if (cryptoRef) {
            cryptoRef.doc('prices').onSnapshot((doc) => {
                if (doc.exists) {
                    platform.cryptoPrices = doc.data();
                    updateCryptoPricesDisplay();
                    animatePriceChange();
                }
            }, (error) => {
                console.error("Ошибка обновления цен:", error);
            });
        }

        if (notificationsRef) {
            notificationsRef
                .where('userId', '==', currentUser.uid)
                .orderBy('timestamp', 'desc')
                .limit(20)
                .onSnapshot((snapshot) => {
                    platform.notifications = [];
                    snapshot.forEach(doc => {
                        platform.notifications.push({ id: doc.id, ...doc.data() });
                    });
                    updateNotifications();
                    updateNotificationBadge(platform.notifications.filter(n => !n.read).length);
                }, (error) => {
                    console.error("Ошибка обновления уведомлений:", error);
                });
        }

        if (usersRef) {
            usersRef.where('online', '==', true)
                .onSnapshot((snapshot) => {
                    updateOnlineUsersCount(snapshot.size);
                }, (error) => {
                    console.error("Ошибка обновления онлайн-пользователей:", error);
                });
        }

        if (withdrawalsRef && currentUser) {
            withdrawalsRef
                .where('userId', '==', currentUser.uid)
                .orderBy('timestamp', 'desc')
                .limit(20)
                .onSnapshot((snapshot) => {
                    const history = [];
                    snapshot.forEach(doc => history.push({ id: doc.id, ...doc.data() }));
                    updateWithdrawHistory(history);
                }, (error) => {
                    console.error("Ошибка обновления истории выводов:", error);
                });
        }

    } catch (error) {
        console.error("Ошибка настройки realtime updates:", error);
    }
}

// ================== ОСНОВНЫЕ ОПЕРАЦИИ ==================
async function processDeposit(amountUSD) {
    if (!firebaseInitialized || !currentUser) {
        showError("Функция недоступна в оффлайн-режиме");
        return;
    }

    showLoading("Обработка платежа...");

    try {
        const skyAmount = Math.floor(amountUSD * USD_TO_SKY);

        await usersRef.doc(currentUser.uid).update({
            balance: firebase.firestore.FieldValue.increment(skyAmount),
            totalDeposited: firebase.firestore.FieldValue.increment(amountUSD)
        });

        await db.collection('transactions').add({
            userId: currentUser.uid,
            type: 'deposit',
            amount: skyAmount,
            amountUSD: amountUSD,
            status: 'completed',
            timestamp: firebase.firestore.FieldValue.serverTimestamp(),
            method: 'telegram'
        });

        await createNotification(
            currentUser.uid,
            'Пополнение баланса',
            `Ваш баланс пополнен на ${skyAmount.toLocaleString()} SKY ($${amountUSD})`,
            'success'
        );

        hideLoading();
        showSuccess(`Баланс пополнен на ${skyAmount.toLocaleString()} SKY!`);

    } catch (error) {
        hideLoading();
        showError("Ошибка при пополнении баланса");
        console.error(error);
    }
}

async function processWithdraw(amountSKY, method, details) {
    if (!firebaseInitialized || !currentUser) {
        showError("Функция недоступна в оффлайн-режиме");
        return;
    }

    showLoading("Обработка вывода...");

    try {
        if (amountSKY < 100) {
            throw new Error("Минимальная сумма вывода - 100 SKY");
        }

        if (amountSKY > platform.balance) {
            throw new Error("Недостаточно средств");
        }

        const feePlatform = amountSKY * 0.01;
        const feeNetwork = calculateNetworkFee(method, amountSKY);
        const total = amountSKY - feePlatform - feeNetwork;

        const withdrawRequest = {
            userId: currentUser.uid,
            amount: amountSKY,
            amountReceived: total,
            method: method,
            details: details,
            feePlatform: feePlatform,
            feeNetwork: feeNetwork,
            status: 'pending',
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        };

        await withdrawalsRef.add(withdrawRequest);

        await usersRef.doc(currentUser.uid).update({
            balance: firebase.firestore.FieldValue.increment(-amountSKY)
        });

        await createNotification(
            currentUser.uid,
            'Заявка на вывод',
            `Создана заявка на вывод ${amountSKY.toLocaleString()} SKY`,
            'info'
        );

        hideLoading();
        showSuccess(`Заявка на вывод создана! Вы получите ${total.toLocaleString()} SKY`);

    } catch (error) {
        hideLoading();
        showError(error.message);
    }
}

function buyToken(coin, amount) {
    if (!amount || amount <= 0) {
        showError("Введите корректное количество");
        return;
    }

    const price = platform.cryptoPrices[coin] || 0;
    const cost = amount * price;
    const fee = cost * 0.005;
    const total = cost + fee;

    if (total > platform.balance) {
        showError("Недостаточно средств");
        return;
    }

    platform.balance -= total;
    platform.portfolio[coin] = (platform.portfolio[coin] || 0) + amount;

    if (firebaseInitialized && currentUser && usersRef) {
        usersRef.doc(currentUser.uid).update({
            balance: platform.balance,
            portfolio: platform.portfolio
        }).catch(err => console.warn("Ошибка синхронизации портфеля:", err));
    }

    const order = {
        id: 'order_' + Date.now(),
        type: 'buy',
        coin: coin,
        amount: amount,
        price: price,
        total: total,
        timestamp: new Date().toISOString()
    };
    platform.orders.unshift(order);

    createNotification(
        currentUser ? currentUser.uid : 'guest',
        'Покупка токенов',
        `Куплено ${amount} ${coin.toUpperCase()} за ${total.toFixed(2)} SKY`,
        'info'
    );

    updateBalanceDisplay();
    updatePortfolioDisplay();
    updateOrderBook();

    showSuccess(`Куплено ${amount} ${coin.toUpperCase()} за ${total.toFixed(2)} SKY`);
}

function sellToken(coin, amount) {
    if (!amount || amount <= 0) {
        showError("Введите корректное количество");
        return;
    }

    const currentHoldings = platform.portfolio[coin] || 0;
    if (amount > currentHoldings) {
        showError("Недостаточно токенов для продажи");
        return;
    }

    const price = platform.cryptoPrices[coin] || 0;
    const revenue = amount * price;
    const fee = revenue * 0.005;
    const total = revenue - fee;

    platform.portfolio[coin] -= amount;
    platform.balance += total;

    if (firebaseInitialized && currentUser && usersRef) {
        usersRef.doc(currentUser.uid).update({
            balance: platform.balance,
            portfolio: platform.portfolio
        }).catch(err => console.warn("Ошибка синхронизации портфеля:", err));
    }

    const order = {
        id: 'order_' + Date.now(),
        type: 'sell',
        coin: coin,
        amount: amount,
        price: price,
        total: total,
        timestamp: new Date().toISOString()
    };
    platform.orders.unshift(order);

    createNotification(
        currentUser ? currentUser.uid : 'guest',
        'Продажа токенов',
        `Продано ${amount} ${coin.toUpperCase()}, получено ${total.toFixed(2)} SKY`,
        'info'
    );

    updateBalanceDisplay();
    updatePortfolioDisplay();
    updateOrderBook();

    showSuccess(`Продано ${amount} ${coin.toUpperCase()}, получено ${total.toFixed(2)} SKY`);
}

// ================== ИНВЕСТИРОВАНИЕ ==================
function investInProject(projectId, amountSKY) {
    if (!amountSKY || amountSKY <= 0) {
        showError("Введите корректную сумму");
        return;
    }

    ensureDefaultProject();
    let project = platform.projects[projectId];
    if (!project) {
        platform.projects[projectId] = {
            name: 'Башня Тысячелетия',
            target: 5500000000,
            raised: 0,
            yield: 8.3,
            duration: 15,
            exitYear: 2035,
            description: 'Самое высокое здание в мире (1100 м).',
            investors: 0
        };
        project = platform.projects[projectId];
    }

    if (amountSKY < 1000) {
        showError("Минимальная инвестиция: 1000 SKY");
        return;
    }

    if (amountSKY > platform.balance) {
        showError(`Недостаточно средств. Доступно: ${platform.balance.toLocaleString()} SKY`);
        return;
    }

    const sharesBought = Math.floor(amountSKY / 1000);
    const cost = sharesBought * 1000;

    platform.balance -= cost;

    if (!platform.userData.projectShares) platform.userData.projectShares = {};
    platform.userData.projectShares[projectId] = (platform.userData.projectShares[projectId] || 0) + sharesBought;

    project.raised = (project.raised || 0) + cost;
    project.investors = (project.investors || 0) + 1;

    if (firebaseInitialized && currentUser && usersRef) {
        usersRef.doc(currentUser.uid).update({
            balance: platform.balance,
            projectShares: platform.userData.projectShares
        }).catch(err => console.warn("Ошибка синхронизации инвестиций:", err));

        if (projectsRef) {
            projectsRef.doc(projectId).update({
                raised: project.raised,
                investors: project.investors
            }).catch(err => console.warn("Ошибка обновления проекта:", err));
        }
    }

    createNotification(
        currentUser ? currentUser.uid : 'guest',
        'Инвестиция в проект',
        `Инвестировано ${cost.toLocaleString()} SKY в проект "${project.name}"`,
        'success'
    );

    updateBalanceDisplay();
    updateProjectStats();

    const projectDetailModal = document.getElementById('project-detail-modal');
    if (projectDetailModal && projectDetailModal.style.display === 'flex') {
        showFullProjectDetail(projectId);
    }

    showSuccess(`Инвестировано ${cost} SKY, получено ${sharesBought} долей в проекте!`);
}

// ================== ДЕТАЛИ ПРОЕКТА ==================
function showFullProjectDetail(projectId) {
    ensureDefaultProject();
    let project = platform.projects[projectId];
    if (!project) {
        project = {
            name: 'Башня Тысячелетия',
            target: 5500000000,
            raised: 0,
            yield: 8.3,
            duration: 15,
            exitYear: 2035,
            description: 'Самое высокое здание в мире (1100 м). Офисы, апартаменты, отель.',
            investors: 0
        };
    }

    const modal = document.getElementById('project-detail-modal');
    const content = document.getElementById('project-detail-content');
    if (!modal || !content) return;

    const raised = project.raised || 0;
    const target = project.target || 1;
    const percent = (raised / target * 100).toFixed(1);

    const userShares = platform.userData.projectShares?.[projectId] || 0;
    const userPercent = (userShares / PROJECT_TOTAL_SHARES * 100).toFixed(4);
    const userProfit = calculateUserProfit(projectId);

    const soldShares = Math.floor(raised / 1000);
    const otherInvestorsPercent = ((soldShares - userShares) / PROJECT_TOTAL_SHARES * 100).toFixed(2);
    const unsoldPercent = (100 - (soldShares / PROJECT_TOTAL_SHARES * 100)).toFixed(2);

    content.innerHTML = `
        <h4 style="color: var(--secondary); margin-bottom: 15px;">${project.name}</h4>
        <p style="color: var(--gray); line-height: 1.5; margin-bottom: 20px;">${project.description}</p>

        <div class="project-stats">
            <div class="stat-box">
                <div class="stat-label">Собрано</div>
                <div class="stat-value">$${(raised / 1e6).toFixed(1)}M</div>
                <div style="color: var(--gray); font-size: 0.85rem;">из $${(target / 1e6).toFixed(1)}M</div>
            </div>
            <div class="stat-box">
                <div class="stat-label">Доходность</div>
                <div class="stat-value">${project.yield}%</div>
            </div>
            <div class="stat-box">
                <div class="stat-label">Срок</div>
                <div class="stat-value">${project.duration} лет</div>
            </div>
        </div>

        <div class="investment-progress" style="margin: 20px 0;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                <span>Прогресс сбора:</span>
                <span style="color: var(--success);">${percent}%</span>
            </div>
            <div style="height: 8px; background: rgba(255,255,255,0.1); border-radius: 4px;">
                <div style="width: ${percent}%; height: 100%; background: linear-gradient(90deg, var(--secondary), var(--success)); border-radius: 4px;"></div>
            </div>
        </div>

        <div class="share-chart-wrapper">
            <div class="share-chart-info">
                <h5 style="color: var(--secondary); margin-bottom: 15px;">Распределение долей</h5>
                <div style="margin-bottom: 15px;">
                    <div style="height: 30px; display: flex; border-radius: 6px; overflow: hidden; margin-bottom: 10px;">
                        ${userShares > 0 ? `<div style="width: ${userPercent}%; background: #4CAF50;" title="Ваша доля"></div>` : ''}
                        ${(soldShares - userShares) > 0 ? `<div style="width: ${otherInvestorsPercent}%; background: #2196F3;" title="Другие инвесторы"></div>` : ''}
                        <div style="width: ${unsoldPercent}%; background: #9E9E9E;" title="Не продано"></div>
                    </div>
                    
                    <div class="share-info-list">
                        ${userShares > 0 ? `
                        <div class="share-info-item">
                            <span class="share-info-label"><span style="color: #4CAF50;">●</span> Ваша доля:</span>
                            <span class="share-info-value">${userPercent}% (${userShares} долей)</span>
                        </div>` : ''}
                        
                        ${(soldShares - userShares) > 0 ? `
                        <div class="share-info-item">
                            <span class="share-info-label"><span style="color: #2196F3;">●</span> Другие инвесторы:</span>
                            <span class="share-info-value">${otherInvestorsPercent}%</span>
                        </div>` : ''}
                        
                        <div class="share-info-item">
                            <span class="share-info-label"><span style="color: #9E9E9E;">●</span> Доступно для покупки:</span>
                            <span class="share-info-value">${unsoldPercent}%</span>
                        </div>
                    </div>
                </div>
            </div>
            
            <div class="share-chart-info">
                <h5 style="color: var(--secondary); margin-bottom: 10px;">Ваша статистика</h5>
                <div class="share-info-list">
                    <div class="share-info-item">
                        <span class="share-info-label">Ваши доли:</span>
                        <span class="share-info-value">${userShares.toLocaleString()}</span>
                    </div>
                    <div class="share-info-item">
                        <span class="share-info-label">Ваша доля в проекте:</span>
                        <span class="share-info-value">${userPercent}%</span>
                    </div>
                    <div class="share-info-item">
                        <span class="share-info-label">Ожидаемая прибыль в месяц:</span>
                        <span class="share-info-value">$${userProfit.toFixed(2)}</span>
                    </div>
                    <div class="share-info-item">
                        <span class="share-info-label">В SKY токенах:</span>
                        <span class="share-info-value">${(userProfit / SKY_TO_USD).toFixed(2)} SKY</span>
                    </div>
                </div>
            </div>
        </div>

        <div class="share-sell-note">
            <h5><i class="fas fa-info-circle"></i> Условия выхода</h5>
            <p style="font-size: 0.9rem; color: var(--gray);">После 2035 года вы сможете продать долю обратно компании за 125% от стоимости инвестиций. Досрочная продажа доступна на рынке.</p>
        </div>

        <div style="margin: 25px 0 10px; background: rgba(0,0,0,0.3); padding: 15px; border-radius: 12px;">
            <h5 style="color: var(--success); margin-bottom: 15px;"><i class="fas fa-chart-line"></i> ИНВЕСТИРОВАТЬ В ПРОЕКТ</h5>
            <div class="form-group">
                <label>Сумма инвестиции (SKY):</label>
                <input type="number" id="invest-amount-detail" class="invest-amount-detail" placeholder="Минимум 1000 SKY" min="1000" step="100" value="1000" max="${platform.balance}">
            </div>
            <div style="background: rgba(0,0,0,0.3); padding: 12px; border-radius: 12px; margin: 15px 0;">
                <p style="color: var(--gray);">1 доля = 1000 SKY</p>
                <p>Вы получите долей: <span id="invest-shares-detail">1</span></p>
                <p style="color: var(--warning); margin-top: 8px;" id="invest-balance-info-detail">Доступно: ${platform.balance.toLocaleString()} SKY</p>
            </div>
            <button class="btn btn-success btn-block" id="btn-invest-detail">
                <i class="fas fa-check"></i> ИНВЕСТИРОВАТЬ
            </button>
        </div>
    `;

    const investInput = document.getElementById('invest-amount-detail');
    const sharesSpan = document.getElementById('invest-shares-detail');
    const balanceInfo = document.getElementById('invest-balance-info-detail');
    const investBtn = document.getElementById('btn-invest-detail');

    if (investInput) {
        investInput.max = platform.balance;

        const updateInvestDetail = () => {
            const amount = parseFloat(investInput.value) || 0;
            const shares = Math.floor(amount / 1000);
            sharesSpan.innerText = shares;

            if (amount > platform.balance) {
                balanceInfo.innerHTML = `Недостаточно средств! Доступно: ${platform.balance.toLocaleString()} SKY`;
                balanceInfo.style.color = 'var(--accent)';
                investBtn.disabled = true;
                investBtn.style.opacity = 0.5;
            } else {
                balanceInfo.innerHTML = `Доступно: ${platform.balance.toLocaleString()} SKY`;
                balanceInfo.style.color = 'var(--warning)';
                investBtn.disabled = false;
                investBtn.style.opacity = 1;
            }
        };

        investInput.addEventListener('input', updateInvestDetail);
        updateInvestDetail();

        investBtn.addEventListener('click', function () {
            const amount = parseFloat(investInput.value);
            if (amount && amount > 0) {
                investInProject(projectId, amount);
            }
        });
    }

    modal.style.display = 'flex';
}

// ================== ИНИЦИАЛИЗАЦИЯ UI ==================
function initUI() {
    console.log("Инициализация интерфейса...");
    updateBalanceDisplay();
    updateCryptoPricesDisplay();
    updatePortfolioDisplay();
    updateOrderBook();
    updateDealsList();
    updateNotifications();
    updateProjectStats();
    initWheelGame();
    createPartialDealModal();

    // Навигация
    document.querySelectorAll('.bottom-nav-item').forEach(item => {
        item.addEventListener('click', function (e) {
            e.preventDefault();
            const section = this.getAttribute('data-section');
            showSection(section);
            document.querySelectorAll('.bottom-nav-item').forEach(nav => nav.classList.remove('active'));
            this.classList.add('active');
        });
    });

    // Кнопки
    document.getElementById('btn-deposit')?.addEventListener('click', openDepositModal);
    document.getElementById('notification-btn')?.addEventListener('click', () => {
        const modal = document.getElementById('notification-modal');
        if (modal) modal.style.display = 'flex';
    });

    document.querySelectorAll('.close-modal').forEach(btn => {
        btn.addEventListener('click', function () {
            this.closest('.modal').style.display = 'none';
        });
    });

    window.addEventListener('click', function (e) {
        if (e.target.classList.contains('modal')) {
            e.target.style.display = 'none';
        }
    });

    initActionButtons();
    initExchangeListeners();
    initMarketListeners();
    initWithdrawListeners();

    document.getElementById('deposit-usd')?.addEventListener('input', updateDepositReceive);
    document.getElementById('btn-invest-now')?.addEventListener('click', () => {
        showSection('projects');
        showFullProjectDetail('millennium-tower');
    });
    document.querySelector('.help-btn')?.addEventListener('click', showHelp);
}

// ================== КНОПКИ ДЕЙСТВИЙ ==================
function initActionButtons() {
    document.getElementById('btn-process-deposit')?.addEventListener('click', function () {
        const amountInput = document.getElementById('deposit-usd');
        if (amountInput && amountInput.value) {
            const amount = parseFloat(amountInput.value);
            if (amount > 0) {
                processDeposit(amount);
                document.getElementById('deposit-modal').style.display = 'none';
                amountInput.value = '';
                updateDepositReceive();
            }
        }
    });

    document.getElementById('btn-withdraw')?.addEventListener('click', function () {
        const amountInput = document.getElementById('withdraw-amount');
        const methodSelect = document.getElementById('withdraw-method');
        const details = {};

        if (amountInput && amountInput.value) {
            const amount = parseFloat(amountInput.value);
            const method = methodSelect ? methodSelect.value : 'crypto';

            if (amount > 0) {
                processWithdraw(amount, method, details);
                document.getElementById('withdraw-modal').style.display = 'none';
                amountInput.value = '';
            }
        }
    });

    document.getElementById('btn-clear-all-notifications')?.addEventListener('click', function () {
        if (firebaseInitialized && notificationsRef && currentUser) {
            notificationsRef.where('userId', '==', currentUser.uid).get().then(snapshot => {
                snapshot.forEach(doc => doc.ref.delete());
            });
        } else {
            platform.notifications = [];
            updateNotifications();
            updateNotificationBadge(0);
        }
        showNotification("Все уведомления очищены", "info");
    });

    document.getElementById('btn-buy')?.addEventListener('click', function () {
        const coin = platform.tempData.selectedCoin;
        const amount = parseFloat(document.getElementById('buy-amount').value);
        buyToken(coin, amount);
    });

    document.getElementById('btn-sell')?.addEventListener('click', function () {
        const coin = platform.tempData.selectedCoin;
        const amount = parseFloat(document.getElementById('sell-amount').value);
        sellToken(coin, amount);
    });

    document.getElementById('btn-create-deal')?.addEventListener('click', createDeal);
    document.getElementById('btn-search-deals')?.addEventListener('click', filterDeals);
    document.getElementById('btn-watch-random-ad')?.addEventListener('click', watchAd);
}

// ================== БИРЖА ==================
function initExchangeListeners() {
    document.querySelectorAll('.crypto-card').forEach(card => {
        card.addEventListener('click', function () {
            const coin = this.getAttribute('data-coin');
            if (coin) {
                platform.tempData.selectedCoin = coin;
                document.querySelectorAll('.crypto-card').forEach(c => c.classList.remove('selected'));
                this.classList.add('selected');
                updateExchangeFields(coin);
            }
        });
    });

    document.getElementById('buy-amount')?.addEventListener('input', updateBuyCost);
    document.getElementById('sell-amount')?.addEventListener('input', updateSellRevenue);
}

function updateExchangeFields(coin) {
    const price = platform.cryptoPrices[coin] || 0;
    const buyPriceDisplay = document.getElementById('buy-price-display');
    const buyPrice = document.getElementById('buy-price');
    const sellPriceDisplay = document.getElementById('sell-price-display');
    const sellPrice = document.getElementById('sell-price');
    const buyCoinName = document.getElementById('buy-coin-name');
    const sellCoinName = document.getElementById('sell-coin-name');

    if (buyPriceDisplay) buyPriceDisplay.innerText = price + ' SKY';
    if (buyPrice) buyPrice.value = price;
    if (sellPriceDisplay) sellPriceDisplay.innerText = price + ' SKY';
    if (sellPrice) sellPrice.value = price;
    if (buyCoinName) buyCoinName.innerText = coin.toUpperCase();
    if (sellCoinName) sellCoinName.innerText = coin.toUpperCase();

    updateBuyCost();
    updateSellRevenue();
}

function updateBuyCost() {
    const amount = parseFloat(document.getElementById('buy-amount')?.value) || 0;
    const price = parseFloat(document.getElementById('buy-price')?.value) || 0;
    const cost = amount * price;
    const fee = cost * 0.005;
    const total = cost + fee;
    const buyCostEl = document.getElementById('buy-cost');
    const buyFeeEl = document.getElementById('buy-fee');
    if (buyCostEl) buyCostEl.innerText = total.toFixed(2) + ' SKY';
    if (buyFeeEl) buyFeeEl.innerText = fee.toFixed(2) + ' SKY';
}

function updateSellRevenue() {
    const amount = parseFloat(document.getElementById('sell-amount')?.value) || 0;
    const price = parseFloat(document.getElementById('sell-price')?.value) || 0;
    const revenue = amount * price;
    const fee = revenue * 0.005;
    const total = revenue - fee;
    const sellRevenueEl = document.getElementById('sell-revenue');
    const sellFeeEl = document.getElementById('sell-fee');
    if (sellRevenueEl) sellRevenueEl.innerText = total.toFixed(2) + ' SKY';
    if (sellFeeEl) sellFeeEl.innerText = fee.toFixed(2) + ' SKY';
}

// ================== РЫНОК (СДЕЛКИ) ==================
function initMarketListeners() {
    document.getElementById('deal-type')?.addEventListener('change', updateDealSummary);
    document.getElementById('deal-asset')?.addEventListener('change', updateDealSummary);
    document.getElementById('deal-quantity')?.addEventListener('input', updateDealSummary);
    document.getElementById('deal-price')?.addEventListener('input', updateDealSummary);

    document.getElementById('filter-type')?.addEventListener('change', filterDeals);
    document.getElementById('filter-asset')?.addEventListener('change', filterDeals);
    document.getElementById('filter-max-price')?.addEventListener('input', filterDeals);
}

function updateDealSummary() {
    const type = document.getElementById('deal-type')?.value || 'sell';
    const assetSelect = document.getElementById('deal-asset');
    const assetText = assetSelect?.options[assetSelect.selectedIndex]?.text || '';
    const quantity = parseFloat(document.getElementById('deal-quantity')?.value) || 0;
    const price = parseFloat(document.getElementById('deal-price')?.value) || 0;
    const total = quantity * price;

    const summaryType = document.getElementById('deal-summary-type');
    const summaryAsset = document.getElementById('deal-summary-asset');
    const summaryQuantity = document.getElementById('deal-summary-quantity');
    const summaryPrice = document.getElementById('deal-summary-price');
    const summaryTotal = document.getElementById('deal-summary-total');

    if (summaryType) summaryType.innerText = type === 'sell' ? 'Продажа' : 'Покупка';
    if (summaryAsset) summaryAsset.innerText = assetText;
    if (summaryQuantity) summaryQuantity.innerText = quantity + ' шт.';
    if (summaryPrice) summaryPrice.innerText = price + ' SKY';
    if (summaryTotal) summaryTotal.innerText = total.toFixed(2) + ' SKY';
}

function createDeal() {
    const type = document.getElementById('deal-type')?.value;
    const asset = document.getElementById('deal-asset')?.value;
    const quantity = parseFloat(document.getElementById('deal-quantity')?.value);
    const price = parseFloat(document.getElementById('deal-price')?.value);
    const partial = document.getElementById('deal-partial')?.value === 'yes';
    const description = document.getElementById('deal-description')?.value;

    if (!quantity || quantity <= 0 || !price || price <= 0) {
        showError("Заполните количество и цену");
        return;
    }

    if (type === 'sell') {
        if (asset.startsWith('millennium')) {
            if ((platform.userData.projectShares?.['millennium-tower'] || 0) < quantity) {
                showError("У вас недостаточно долей для продажи");
                return;
            }
        } else {
            if ((platform.portfolio[asset] || 0) < quantity) {
                showError("У вас недостаточно токенов для продажи");
                return;
            }
        }
    }

    const newDeal = {
        id: 'deal_' + Date.now(),
        type: type,
        asset: asset,
        quantity: quantity,
        price: price,
        partial: partial,
        description: description,
        userName: platform.userData.username || 'Гость',
        userId: currentUser ? currentUser.uid : 'guest',
        status: 'active',
        createdAt: new Date().toISOString()
    };

    platform.deals.unshift(newDeal);
    updateDealsList();

    if (firebaseInitialized && dealsRef) {
        dealsRef.add(newDeal).catch(err => console.warn("Ошибка сохранения сделки:", err));
    }

    showSuccess("Сделка создана");
    const quantityInput = document.getElementById('deal-quantity');
    const priceInput = document.getElementById('deal-price');
    const descInput = document.getElementById('deal-description');
    if (quantityInput) quantityInput.value = 1;
    if (priceInput) priceInput.value = 1;
    if (descInput) descInput.value = '';
    updateDealSummary();
}

function filterDeals() {
    const type = document.getElementById('filter-type')?.value;
    const asset = document.getElementById('filter-asset')?.value;
    const maxPrice = parseFloat(document.getElementById('filter-max-price')?.value) || Infinity;

    const filtered = platform.deals.filter(deal => {
        if (type !== 'all' && deal.type !== type) return false;
        if (asset !== 'all' && deal.asset !== asset) return false;
        if (deal.price > maxPrice) return false;
        return true;
    });

    displayFilteredDeals(filtered);
}

function displayFilteredDeals(deals) {
    const container = document.getElementById('deals-list');
    if (!container) return;

    if (deals.length === 0) {
        container.innerHTML = '<div class="no-deals">Нет сделок по вашему запросу</div>';
        return;
    }

    let html = '';
    deals.forEach(deal => {
        const isMyDeal = (currentUser && deal.userId === currentUser.uid) || (!currentUser && deal.userId === 'guest');
        html += `
            <div class="deal-item" data-deal-id="${deal.id}">
                <div class="deal-header">
                    <span class="deal-type ${deal.type === 'buy' ? 'deal-type-buy' : 'deal-type-sell'}">${deal.type === 'buy' ? 'Покупка' : 'Продажа'}</span>
                    <span class="deal-asset">${deal.asset}</span>
                </div>
                <div class="deal-info-grid">
                    <div class="deal-info-item">
                        <div class="deal-info-label">Количество</div>
                        <div class="deal-info-value">${deal.quantity}</div>
                    </div>
                    <div class="deal-info-item">
                        <div class="deal-info-label">Цена за шт.</div>
                        <div class="deal-info-value">${deal.price} SKY</div>
                    </div>
                    <div class="deal-info-item">
                        <div class="deal-info-label">Продавец</div>
                        <div class="deal-info-value">${deal.userName}</div>
                    </div>
                </div>
                <div class="deal-actions">
                    <button class="btn btn-primary deal-action" onclick="handleDealAction('${deal.id}')">${deal.type === 'buy' ? 'Продать' : 'Купить'}</button>
                    ${isMyDeal ? `<button class="btn btn-danger deal-delete" onclick="deleteDeal('${deal.id}')"><i class="fas fa-trash"></i> Удалить</button>` : ''}
                </div>
            </div>
        `;
    });
    container.innerHTML = html;
}

function deleteDeal(dealId) {
    if (!confirm("Вы уверены, что хотите удалить эту сделку?")) return;

    const index = platform.deals.findIndex(d => d.id === dealId);
    if (index !== -1) {
        const deal = platform.deals[index];
        const isOwner = (currentUser && deal.userId === currentUser.uid) || (!currentUser && deal.userId === 'guest');
        if (!isOwner) {
            showError("Вы не можете удалить чужую сделку");
            return;
        }

        platform.deals.splice(index, 1);
        updateDealsList();

        if (firebaseInitialized && dealsRef) {
            dealsRef.doc(dealId).delete().catch(err => console.warn("Ошибка удаления сделки из Firebase:", err));
        }

        showSuccess("Сделка удалена");
    }
}

function handleDealAction(dealId) {
    const deal = platform.deals.find(d => d.id === dealId);
    if (!deal) return;

    const isOwner = (currentUser && deal.userId === currentUser.uid) || (!currentUser && deal.userId === 'guest');
    if (deal.type === 'sell' && isOwner) {
        showError("Нельзя купить собственную сделку");
        return;
    }
    if (deal.type === 'buy' && isOwner) {
        showError("Нельзя продать собственную сделку");
        return;
    }

    if (deal.partial) {
        platform.tempData.partialDeal = deal;
        openPartialDealModal(deal);
    } else {
        executeDealFully(deal);
    }
}

function executeDealFully(deal) {
    if (deal.type === 'sell') {
        const totalPrice = deal.quantity * deal.price;
        if (totalPrice > platform.balance) {
            showError("Недостаточно средств");
            return;
        }

        platform.balance -= totalPrice;
        if (deal.asset.startsWith('millennium')) {
            if (!platform.userData.projectShares) platform.userData.projectShares = {};
            platform.userData.projectShares['millennium-tower'] = (platform.userData.projectShares['millennium-tower'] || 0) + deal.quantity;
        } else {
            platform.portfolio[deal.asset] = (platform.portfolio[deal.asset] || 0) + deal.quantity;
        }

        platform.deals = platform.deals.filter(d => d.id !== deal.id);
        updateDealsList();
        updateBalanceDisplay();
        updatePortfolioDisplay();

        showSuccess("Сделка выполнена");
    } else {
        if (deal.asset.startsWith('millennium')) {
            if ((platform.userData.projectShares?.['millennium-tower'] || 0) < deal.quantity) {
                showError("У вас недостаточно долей");
                return;
            }
            platform.userData.projectShares['millennium-tower'] -= deal.quantity;
        } else {
            if ((platform.portfolio[deal.asset] || 0) < deal.quantity) {
                showError("У вас недостаточно токенов");
                return;
            }
            platform.portfolio[deal.asset] -= deal.quantity;
        }

        const totalPrice = deal.quantity * deal.price;
        platform.balance += totalPrice;

        platform.deals = platform.deals.filter(d => d.id !== deal.id);
        updateDealsList();
        updateBalanceDisplay();
        updatePortfolioDisplay();

        showSuccess("Сделка выполнена");
    }

    if (firebaseInitialized && currentUser && usersRef) {
        usersRef.doc(currentUser.uid).update({
            balance: platform.balance,
            portfolio: platform.portfolio,
            projectShares: platform.userData.projectShares
        }).catch(err => console.warn("Ошибка синхронизации после сделки:", err));

        if (dealsRef) {
            dealsRef.doc(deal.id).delete().catch(err => console.warn("Ошибка удаления сделки из Firebase:", err));
        }
    }
}

function createPartialDealModal() {
    if (document.getElementById('partial-deal-modal')) return;

    const modal = document.createElement('div');
    modal.id = 'partial-deal-modal';
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3 style="color: var(--secondary);"><i class="fas fa-cut"></i> ЧАСТИЧНАЯ СДЕЛКА</h3>
                <button class="close-modal" onclick="document.getElementById('partial-deal-modal').style.display='none'">&times;</button>
            </div>
            <div style="padding: 15px;">
                <p id="partial-deal-info"></p>
                <div class="form-group">
                    <label>Количество (<span id="partial-max-quantity"></span>):</label>
                    <input type="number" id="partial-quantity" min="1" step="1" value="1">
                </div>
                <div style="background: rgba(0,0,0,0.3); padding: 12px; border-radius: 12px; margin: 15px 0;">
                    <p>Сумма сделки: <span id="partial-total"></span> SKY</p>
                </div>
                <button class="btn btn-success btn-block" id="btn-execute-partial">ПОДТВЕРДИТЬ</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('btn-execute-partial').addEventListener('click', () => {
        const deal = platform.tempData.partialDeal;
        if (!deal) return;

        const quantity = parseInt(document.getElementById('partial-quantity').value);
        if (quantity <= 0 || quantity > deal.quantity) {
            showError(`Количество должно быть от 1 до ${deal.quantity}`);
            return;
        }

        executePartialDeal(deal, quantity);
    });
}

function openPartialDealModal(deal) {
    platform.tempData.partialDeal = deal;
    const modal = document.getElementById('partial-deal-modal');
    if (!modal) createPartialDealModal();

    document.getElementById('partial-deal-info').innerText = `${deal.type === 'sell' ? 'Покупка' : 'Продажа'} ${deal.asset} по цене ${deal.price} SKY за шт.`;
    document.getElementById('partial-max-quantity').innerText = `макс. ${deal.quantity}`;
    const quantInput = document.getElementById('partial-quantity');
    quantInput.max = deal.quantity;
    quantInput.value = 1;
    updatePartialTotal();

    quantInput.addEventListener('input', updatePartialTotal);
    modal.style.display = 'flex';
}

function updatePartialTotal() {
    const deal = platform.tempData.partialDeal;
    if (!deal) return;
    const quantity = parseInt(document.getElementById('partial-quantity')?.value) || 0;
    const totalEl = document.getElementById('partial-total');
    if (totalEl) totalEl.innerText = (quantity * deal.price).toFixed(2);
}

function executePartialDeal(deal, quantity) {
    const totalPrice = quantity * deal.price;

    if (deal.type === 'sell') {
        if (totalPrice > platform.balance) {
            showError("Недостаточно средств");
            return;
        }

        platform.balance -= totalPrice;
        if (deal.asset.startsWith('millennium')) {
            platform.userData.projectShares['millennium-tower'] = (platform.userData.projectShares['millennium-tower'] || 0) + quantity;
        } else {
            platform.portfolio[deal.asset] = (platform.portfolio[deal.asset] || 0) + quantity;
        }
    } else {
        if (deal.asset.startsWith('millennium')) {
            if ((platform.userData.projectShares?.['millennium-tower'] || 0) < quantity) {
                showError("У вас недостаточно долей");
                return;
            }
            platform.userData.projectShares['millennium-tower'] -= quantity;
        } else {
            if ((platform.portfolio[deal.asset] || 0) < quantity) {
                showError("У вас недостаточно токенов");
                return;
            }
            platform.portfolio[deal.asset] -= quantity;
        }

        platform.balance += totalPrice;
    }

    if (quantity === deal.quantity) {
        platform.deals = platform.deals.filter(d => d.id !== deal.id);
        if (firebaseInitialized && dealsRef) {
            dealsRef.doc(deal.id).delete().catch(err => console.warn("Ошибка удаления сделки из Firebase:", err));
        }
    } else {
        deal.quantity -= quantity;
        if (firebaseInitialized && dealsRef) {
            dealsRef.doc(deal.id).update({ quantity: deal.quantity }).catch(err => console.warn("Ошибка обновления сделки в Firebase:", err));
        }
    }

    updateDealsList();
    updateBalanceDisplay();
    updatePortfolioDisplay();

    if (firebaseInitialized && currentUser && usersRef) {
        usersRef.doc(currentUser.uid).update({
            balance: platform.balance,
            portfolio: platform.portfolio,
            projectShares: platform.userData.projectShares
        }).catch(err => console.warn("Ошибка синхронизации после частичной сделки:", err));
    }

    document.getElementById('partial-deal-modal').style.display = 'none';
    showSuccess("Частичная сделка выполнена");
}

// ================== ВЫВОД СРЕДСТВ ==================
function initWithdrawListeners() {
    const methodSelect = document.getElementById('withdraw-method');
    const cryptoDetails = document.getElementById('crypto-details');
    const cardDetails = document.getElementById('card-details');
    const amountInput = document.getElementById('withdraw-amount');

    if (methodSelect) {
        methodSelect.addEventListener('change', function () {
            const val = this.value;
            if (cryptoDetails) cryptoDetails.style.display = val === 'crypto' ? 'block' : 'none';
            if (cardDetails) cardDetails.style.display = (val === 'bank' || val === 'yoomoney' || val === 'qiwi') ? 'block' : 'none';
        });
    }

    if (amountInput) {
        amountInput.addEventListener('input', updateWithdrawSummary);
    }

    document.getElementById('crypto-network')?.addEventListener('change', updateWithdrawSummary);
}

function updateWithdrawSummary() {
    const amount = parseFloat(document.getElementById('withdraw-amount')?.value) || 0;
    const method = document.getElementById('withdraw-method')?.value || 'crypto';
    const network = document.getElementById('crypto-network')?.value || 'trc20';

    let networkFeePercent = 0.02;
    if (network === 'trc20') networkFeePercent = 0.01;
    else if (network === 'erc20') networkFeePercent = 0.03;
    else if (network === 'bep20') networkFeePercent = 0.005;

    const feePlatform = amount * 0.01;
    const feeNetwork = amount * networkFeePercent;
    const total = amount - feePlatform - feeNetwork;

    const summaryAmount = document.getElementById('withdraw-summary-amount');
    const withdrawUsd = document.getElementById('withdraw-usd');
    const feePlatformEl = document.getElementById('withdraw-fee-platform');
    const feeNetworkEl = document.getElementById('withdraw-fee-network');
    const totalEl = document.getElementById('withdraw-total');
    const totalUsdEl = document.getElementById('withdraw-total-usd');

    if (summaryAmount) summaryAmount.innerText = amount.toFixed(2);
    if (withdrawUsd) withdrawUsd.innerText = (amount * SKY_TO_USD).toFixed(2);
    if (feePlatformEl) feePlatformEl.innerText = feePlatform.toFixed(2) + ' SKY';
    if (feeNetworkEl) feeNetworkEl.innerText = feeNetwork.toFixed(2) + ' SKY';
    if (totalEl) totalEl.innerText = total.toFixed(2);
    if (totalUsdEl) totalUsdEl.innerText = (total * SKY_TO_USD).toFixed(2);
}

// ================== РЕКЛАМА ==================
function watchAd() {
    checkAndResetAdCounter();

    let watched = parseInt(localStorage.getItem('ads_watched_today') || '0');
    if (watched >= 50) {
        showError("Вы достигли лимита просмотров на сегодня (50)");
        return;
    }

    const reward = 3;
    platform.balance += reward;

    if (firebaseInitialized && currentUser && usersRef) {
        usersRef.doc(currentUser.uid).update({
            balance: firebase.firestore.FieldValue.increment(reward)
        }).catch(err => console.warn("Ошибка начисления за рекламу:", err));
    }

    updateBalanceDisplay();
    showSuccess(`+${reward} SKY за просмотр рекламы`);

    watched++;
    localStorage.setItem('ads_watched_today', watched);

    const totalEarnedToday = watched * 3;
    let totalEarnedAll = parseInt(localStorage.getItem('total_earned') || '0') + 3;
    localStorage.setItem('total_earned', totalEarnedAll);

    const adsWatchedEl = document.getElementById('ads-watched');
    const earnedTodayEl = document.getElementById('earned-today');
    const totalEarnedEl = document.getElementById('total-earned');
    if (adsWatchedEl) adsWatchedEl.innerText = watched + '/50';
    if (earnedTodayEl) earnedTodayEl.innerText = totalEarnedToday + ' SKY';
    if (totalEarnedEl) totalEarnedEl.innerText = totalEarnedAll + ' SKY';
}

function initAdStats() {
    checkAndResetAdCounter();
    const watched = parseInt(localStorage.getItem('ads_watched_today') || '0');
    const totalEarned = parseInt(localStorage.getItem('total_earned') || '0');
    document.getElementById('ads-watched').innerText = watched + '/50';
    document.getElementById('earned-today').innerText = (watched * 3) + ' SKY';
    document.getElementById('total-earned').innerText = totalEarned + ' SKY';
}

function checkAndResetAdCounter() {
    const lastResetDate = localStorage.getItem('ad_last_reset');
    const today = new Date().toDateString();

    if (lastResetDate !== today) {
        localStorage.setItem('ad_last_reset', today);
        localStorage.setItem('ads_watched_today', '0');
    }
}

// ================== КОЛЕСО ВЕЗЕНИЯ ==================
function initWheelGame() {
    startWheelRound();
    drawWheel();
}

function startWheelRound() {
    const now = Date.now();
    platform.tempData.wheelGame.roundEnd = now + 60000;
    platform.tempData.wheelGame.players = [];
    platform.tempData.wheelGame.totalBet = 0;
    platform.tempData.wheelGame.prizePool = 0;
    platform.tempData.wheelGame.spinAnimation = false;

    if (platform.tempData.wheelGame.timerInterval) {
        clearInterval(platform.tempData.wheelGame.timerInterval);
    }

    platform.tempData.wheelGame.timerInterval = setInterval(updateWheelTimer, 1000);
    updateWheelDisplay();
    drawWheel();
}

function updateWheelTimer() {
    const now = Date.now();
    const remaining = Math.max(0, Math.floor((platform.tempData.wheelGame.roundEnd - now) / 1000));

    const timerEl = document.getElementById('wheel-timer-modal');
    if (timerEl) timerEl.innerText = remaining;

    if (remaining <= 0 && !platform.tempData.wheelGame.spinAnimation) {
        clearInterval(platform.tempData.wheelGame.timerInterval);
        finishWheelRound();
    }
}

function finishWheelRound() {
    const players = platform.tempData.wheelGame.players;
    if (players.length === 0) {
        startWheelRound();
        return;
    }

    spinWheel(() => {
        const winnerIndex = Math.floor(Math.random() * players.length);
        const winner = players[winnerIndex];
        const prize = Math.floor(platform.tempData.wheelGame.prizePool * 0.95);

        if (winner.userId === (currentUser ? currentUser.uid : 'guest')) {
            platform.balance += prize;
            if (firebaseInitialized && currentUser) {
                usersRef.doc(currentUser.uid).update({
                    balance: firebase.firestore.FieldValue.increment(prize)
                }).catch(err => console.warn("Ошибка начисления приза:", err));
            }
            updateBalanceDisplay();
        }

        showNotification(`Победитель: ${winner.name}! Выигрыш ${prize} SKY`, 'success');

        const totalWinsEl = document.getElementById('casino-total-wins');
        const totalWonEl = document.getElementById('casino-total-won');
        const biggestWinEl = document.getElementById('casino-biggest-win');
        if (totalWinsEl) totalWinsEl.innerText = (parseInt(totalWinsEl.innerText) + 1).toString();
        if (totalWonEl) totalWonEl.innerText = (parseInt(totalWonEl.innerText) + prize).toString() + ' SKY';
        if (biggestWinEl && prize > parseInt(biggestWinEl.innerText)) {
            biggestWinEl.innerText = prize + ' SKY';
        }

        startWheelRound();
    });
}

function drawWheel() {
    const canvas = document.getElementById('wheel-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const width = canvas.width = 250;
    const height = canvas.height = 250;
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = 100;

    ctx.clearRect(0, 0, width, height);

    const players = platform.tempData.wheelGame.players;
    const totalBet = platform.tempData.wheelGame.totalBet;

    if (players.length === 0) {
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
        ctx.fillStyle = '#333';
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.font = '12px Arial';
        ctx.fillText('Нет игроков', centerX - 40, centerY);
        return;
    }

    let startAngle = platform.tempData.wheelGame.spinAngle || 0;
    for (let i = 0; i < players.length; i++) {
        const player = players[i];
        const sliceAngle = (player.bet / totalBet) * 2 * Math.PI;
        const endAngle = startAngle + sliceAngle;

        ctx.beginPath();
        ctx.moveTo(centerX, centerY);
        ctx.arc(centerX, centerY, radius, startAngle, endAngle);
        ctx.closePath();

        const hue = (i * 137) % 360;
        ctx.fillStyle = `hsl(${hue}, 70%, 60%)`;
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.save();
        ctx.translate(centerX, centerY);
        ctx.rotate(startAngle + sliceAngle / 2);
        ctx.textAlign = 'center';
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 10px Arial';
        ctx.fillText(player.name.substring(0, 3), radius * 0.7, 0);
        ctx.restore();

        startAngle = endAngle;
    }
}

function spinWheel(callback) {
    const canvas = document.getElementById('wheel-canvas');
    if (!canvas) return;

    platform.tempData.wheelGame.spinAnimation = true;
    const spinDuration = 2000;
    const startTime = Date.now();
    const startAngle = platform.tempData.wheelGame.spinAngle || 0;

    function animate() {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / spinDuration, 1);
        const angle = startAngle + (20 * Math.PI * (1 - progress));
        platform.tempData.wheelGame.spinAngle = angle;
        drawWheel();

        if (progress < 1) {
            requestAnimationFrame(animate);
        } else {
            platform.tempData.wheelGame.spinAnimation = false;
            platform.tempData.wheelGame.spinAngle = angle % (2 * Math.PI);
            drawWheel();
            if (callback) callback();
        }
    }

    requestAnimationFrame(animate);
}

function openWheelGame() {
    const modal = document.getElementById('wheel-game-modal');
    if (modal) {
        modal.style.display = 'flex';
        updateWheelDisplay();
        drawWheel();
    }
}

function closeWheelGame() {
    document.getElementById('wheel-game-modal').style.display = 'none';
}

function joinWheelGameModal() {
    const betInput = document.getElementById('wheel-bet-modal');
    const bet = parseFloat(betInput?.value);
    if (!bet || bet < 10) {
        showError("Минимальная ставка 10 SKY");
        return;
    }
    if (bet > platform.balance) {
        showError("Недостаточно средств");
        return;
    }

    platform.balance -= bet;

    const player = {
        userId: currentUser ? currentUser.uid : 'guest',
        name: platform.userData.username || 'Гость',
        bet: bet,
        timestamp: Date.now()
    };
    platform.tempData.wheelGame.players.push(player);
    platform.tempData.wheelGame.totalBet += bet;
    platform.tempData.wheelGame.prizePool += bet;

    updateWheelDisplay();
    updateBalanceDisplay();
    drawWheel();

    if (firebaseInitialized && currentUser && usersRef) {
        usersRef.doc(currentUser.uid).update({
            balance: platform.balance
        }).catch(err => console.warn("Ошибка списания ставки:", err));
    }

    showSuccess(`Ставка ${bet} SKY принята!`);
}

function updateWheelDisplay() {
    const players = platform.tempData.wheelGame.players;
    const totalBet = platform.tempData.wheelGame.totalBet;
    const prizePool = platform.tempData.wheelGame.prizePool;

    const playersCountModal = document.getElementById('wheel-players-count-modal');
    const totalBetModal = document.getElementById('wheel-total-bet-modal');
    const prizeModal = document.getElementById('wheel-prize-modal');
    const playersList = document.getElementById('wheel-players-modal');
    const playersCountPreview = document.getElementById('wheel-players-count-preview');

    if (playersCountModal) playersCountModal.innerText = players.length;
    if (totalBetModal) totalBetModal.innerText = totalBet;
    if (prizeModal) prizeModal.innerText = `Призовой фонд: ${Math.floor(prizePool * 0.95)} SKY`;
    if (playersCountPreview) playersCountPreview.innerText = players.length;

    if (playersList) {
        if (players.length === 0) {
            playersList.innerHTML = '<div style="text-align: center; color: var(--gray);">Пока нет игроков</div>';
        } else {
            let html = '';
            players.forEach(p => {
                html += `<div class="player-item"><span>${p.name}</span><span>${p.bet} SKY</span></div>`;
            });
            playersList.innerHTML = html;
        }
    }
}

// ================== ПРИБЫЛЬ ==================
function claimProfit(projectId) {
    const profit = calculateUserProfit(projectId);

    if (profit > 0) {
        const profitInSKY = profit / SKY_TO_USD;
        platform.balance += profitInSKY;
        platform.pendingProfit = 0;

        updateBalanceDisplay();
        const pendingProfitEl = document.getElementById('my-pending-profit');
        if (pendingProfitEl) pendingProfitEl.innerText = '0 SKY';

        showSuccess(`Прибыль ${profitInSKY.toFixed(2)} SKY ($${profit.toFixed(2)}) получена!`);
    } else {
        showNotification("Нет доступной прибыли", "info");
    }
}

function toggleProfitSection() {
    const content = document.getElementById('profit-content');
    const btn = document.querySelector('#profit-toggle-btn i');
    if (content.classList.contains('expanded')) {
        content.classList.remove('expanded');
        content.classList.add('collapsed');
        btn.classList.remove('fa-chevron-down');
        btn.classList.add('fa-chevron-up');
    } else {
        content.classList.remove('collapsed');
        content.classList.add('expanded');
        btn.classList.remove('fa-chevron-up');
        btn.classList.add('fa-chevron-down');
    }
}

function startPayoutTimer() {
    setInterval(updatePayoutTimer, 1000);
}

function updatePayoutTimer() {
    const now = new Date();
    const next = new Date(platform.nextPayoutDate);
    const diff = next - now;
    if (diff <= 0) {
        const profit = calculateUserProfit('millennium-tower');
        platform.pendingProfit += profit / SKY_TO_USD;
        platform.nextPayoutDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
        updateProjectStats();

        if (profit > 0) {
            showNotification(`Начислена прибыль по проекту: $${profit.toFixed(2)}`, 'success');
        }
    }
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);

    const timerStr = `${days}д ${hours}ч ${minutes}м ${seconds}с`;
    const timerEl = document.getElementById('profit-timer');
    if (timerEl) timerEl.innerText = timerStr;
    const nextPayoutEl = document.getElementById('next-payout-timer');
    if (nextPayoutEl) nextPayoutEl.innerText = timerStr;
}

// ================== ОФФЛАЙН РЕЖИМ ==================
function initPlatformOffline() {
    console.log("Запуск в оффлайн режиме");
    hideLoading();

    platform.balance = 10000;
    platform.userData = {
        username: "Гость",
        balance: 10000,
        projectShares: { 'millennium-tower': 0 }
    };
    platform.pendingProfit = 0;

    platform.cryptoPrices = getDemoCryptoPrices();
    platform.deals = getDemoDeals();
    platform.orders = getDemoOrders();
    platform.portfolio = {
        dogemoon: 50,
        pepe: 200,
        shiba: 1000,
        bonk: 10,
        floki: 500
    };

    updateBalanceDisplay();
    updateCryptoPricesDisplay();
    updateDealsList();
    updatePortfolioDisplay();
    updateOrderBook();
    updateProjectStats();

    initUI();

    startPriceSimulator();

    setTimeout(() => {
        showNotification("Вы в оффлайн-режиме. Функции ограничены.", "warning");
    }, 500);

    console.log("Оффлайн-режим активирован");
}

let priceSimulatorInterval = null;

function startPriceSimulator() {
    if (priceSimulatorInterval) clearInterval(priceSimulatorInterval);

    priceSimulatorInterval = setInterval(() => {
        for (let coin in platform.cryptoPrices) {
            let oldPrice = platform.cryptoPrices[coin];
            let change = (Math.random() * 4 - 2) / 100;
            let newPrice = oldPrice * (1 + change);
            if (newPrice < 0.01) newPrice = 0.01;
            platform.cryptoPrices[coin] = newPrice;
        }

        updateCryptoPricesDisplay();
        updatePortfolioDisplay();
        updateExchangeFields(platform.tempData.selectedCoin);
        animatePriceChange();
    }, 10000);
}

// ================== ДЕМО ДАННЫЕ ==================
function getDemoCryptoPrices() {
    return {
        dogemoon: 125,
        pepe: 8.5,
        shiba: 0.24,
        bonk: 180,
        floki: 1.2,
        bitcoin: 65000,
        ethereum: 3500,
        solana: 120
    };
}

function getDemoDeals() {
    return [
        {
            id: "demo1",
            type: "sell",
            asset: "dogemoon",
            quantity: 100,
            price: 130,
            userName: "Демо-пользователь",
            description: "Продажа DogeMoon токенов",
            userId: "demo1"
        },
        {
            id: "demo2",
            type: "buy",
            asset: "pepe",
            quantity: 500,
            price: 8.0,
            userName: "Инвестор",
            description: "Покупка Pepe токенов",
            userId: "demo2"
        }
    ];
}

function getDemoOrders() {
    return [
        { type: 'buy', price: 124, volume: 150 },
        { type: 'buy', price: 123, volume: 200 },
        { type: 'sell', price: 126, volume: 80 },
        { type: 'sell', price: 127, volume: 120 }
    ];
}

// ================== УВЕДОМЛЕНИЯ ==================
function showNotification(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `notification-toast ${type}`;
    toast.innerText = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

function showSuccess(message) {
    showNotification(message, 'success');
}

function showError(message) {
    showNotification(message, 'error');
}

async function createNotification(userId, title, message, type = 'info') {
    if (!firebaseInitialized || !notificationsRef) {
        const localNotif = {
            id: 'notif_' + Date.now(),
            userId: userId,
            title: title,
            message: message,
            type: type,
            read: false,
            timestamp: new Date().toISOString()
        };
        platform.notifications.unshift(localNotif);
        updateNotifications();
        return null;
    }

    try {
        return await notificationsRef.add({
            userId: userId,
            title: title,
            message: message,
            type: type,
            read: false,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });
    } catch (error) {
        console.error("Ошибка создания уведомления:", error);
        return null;
    }
}

// ================== ОТОБРАЖЕНИЕ ДАННЫХ ==================
function updateBalanceDisplay() {
    const balanceEl = document.getElementById('balance');
    const usdEl = document.getElementById('balance-usd');

    if (balanceEl) {
        balanceEl.textContent = platform.balance.toLocaleString('ru-RU') + ' SKY';
    }
    if (usdEl) {
        usdEl.textContent = (platform.balance * SKY_TO_USD).toFixed(2);
    }
}

function updateCryptoPricesDisplay() {
    const container = document.getElementById('crypto-prices-container');
    if (container) {
        let html = '';
        for (const [coin, price] of Object.entries(platform.cryptoPrices)) {
            html += `
                <div class="crypto-item">
                    <span class="crypto-name">${coin.toUpperCase()}</span>
                    <span class="crypto-price">${price.toFixed(2)} SKY</span>
                </div>
            `;
        }
        container.innerHTML = html;
    }

    for (const [coin, price] of Object.entries(platform.cryptoPrices)) {
        const priceEl = document.getElementById(`${coin}-price`);
        if (priceEl) priceEl.innerText = price.toFixed(2) + ' SKY';
    }
}

function updateDealsList() {
    const container = document.getElementById('deals-container');
    if (!container) return;

    if (platform.deals.length === 0) {
        container.innerHTML = '<div class="no-deals">Нет активных сделок</div>';
        return;
    }

    let html = '';
    platform.deals.forEach(deal => {
        const isMyDeal = (currentUser && deal.userId === currentUser.uid) || (!currentUser && deal.userId === 'guest');
        html += `
            <div class="deal-item ${deal.type}">
                <div class="deal-header">
                    <span class="deal-type ${deal.type === 'buy' ? 'deal-type-buy' : 'deal-type-sell'}">${deal.type === 'buy' ? 'Покупка' : 'Продажа'}</span>
                    <span class="deal-asset">${deal.asset}</span>
                </div>
                <div class="deal-info">
                    <div>Количество: ${deal.quantity}</div>
                    <div>Цена: ${deal.price} SKY</div>
                    <div>Продавец: ${deal.userName}</div>
                </div>
                <div class="deal-actions">
                    <button class="btn btn-primary deal-action" onclick="handleDealAction('${deal.id}')">${deal.type === 'buy' ? 'Продать' : 'Купить'}</button>
                    ${isMyDeal ? `<button class="btn btn-danger deal-delete" onclick="deleteDeal('${deal.id}')"><i class="fas fa-trash"></i> Удалить</button>` : ''}
                </div>
            </div>
        `;
    });
    container.innerHTML = html;
}

function updateNotifications() {
    const container = document.getElementById('notifications-list');
    if (!container) return;

    const unreadCount = platform.notifications.filter(n => !n.read).length;

    try {
        if (!platform.notifications || platform.notifications.length === 0) {
            container.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--gray);">Нет уведомлений</div>';
            updateNotificationBadge(0);
            return;
        }

        let html = '';
        platform.notifications.forEach(notif => {
            let timeStr = 'Только что';
            try {
                if (notif.timestamp) {
                    if (notif.timestamp.toDate) {
                        timeStr = formatTime(notif.timestamp.toDate());
                    } else {
                        timeStr = formatTime(new Date(notif.timestamp));
                    }
                }
            } catch (e) {}

            html += `
                <div class="notification-item ${notif.type || 'info'} ${notif.read ? 'read' : 'unread'}" onclick="markNotificationRead('${notif.id}')">
                    <div class="notification-title">${notif.title || 'Уведомление'}</div>
                    <div class="notification-message">${notif.message || ''}</div>
                    <div class="notification-time">${timeStr}</div>
                </div>
            `;
        });

        container.innerHTML = html;
    } catch (error) {
        console.error('Ошибка при отображении уведомлений:', error);
        container.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--accent);">Ошибка загрузки уведомлений</div>';
    } finally {
        updateNotificationBadge(unreadCount);
    }
}

function markNotificationRead(notifId) {
    const notif = platform.notifications.find(n => n.id === notifId);
    if (notif && !notif.read) {
        notif.read = true;
        if (firebaseInitialized && notificationsRef && currentUser) {
            notificationsRef.doc(notifId).update({ read: true }).catch(err => console.warn("Ошибка обновления уведомления:", err));
        }
        updateNotifications();
    }
}

function updateNotificationBadge(count) {
    const badge = document.getElementById('notification-badge');
    if (badge) {
        if (count > 0) {
            badge.textContent = count > 9 ? '9+' : count;
            badge.style.display = 'flex';
        } else {
            badge.style.display = 'none';
        }
    }
}

function updatePortfolioDisplay() {
    const container = document.getElementById('portfolio-list');
    if (!container) return;

    const shortNames = {
        dogemoon: 'DGM',
        pepe: 'PEP',
        shiba: 'SHB',
        bonk: 'BNK',
        floki: 'FLK'
    };

    let html = '<div class="order-row order-row-header"><div>ТОКЕН</div><div>БАЛАНС</div><div>СТОИМОСТЬ (SKY)</div></div>';
    let totalValue = 0;
    for (const [coin, amount] of Object.entries(platform.portfolio)) {
        if (amount > 0) {
            const price = platform.cryptoPrices[coin] || 0;
            const value = amount * price;
            totalValue += value;
            const displayName = shortNames[coin] || coin.toUpperCase();
            html += `
                <div class="order-row">
                    <div>${displayName}</div>
                    <div>${amount}</div>
                    <div>${value.toFixed(2)}</div>
                </div>
            `;
        }
    }
    html += `<div class="order-row" style="font-weight: bold; border-top: 2px solid var(--secondary);"><div>ИТОГО</div><div></div><div>${totalValue.toFixed(2)} SKY</div></div>`;
    container.innerHTML = html;
}

function updateOrderBook() {
    const container = document.getElementById('order-book');
    if (!container) return;

    const buyOrders = platform.orders.filter(o => o.type === 'buy').sort((a, b) => b.price - a.price);
    const sellOrders = platform.orders.filter(o => o.type === 'sell').sort((a, b) => a.price - b.price);

    let html = '<div class="order-row order-row-header"><div>ТИП</div><div>ЦЕНА (SKY)</div><div>ОБЪЕМ</div></div>';
    buyOrders.forEach(o => {
        html += `<div class="order-row"><div style="color: var(--success);">Покупка</div><div>${o.price}</div><div>${o.volume || o.amount}</div></div>`;
    });
    sellOrders.forEach(o => {
        html += `<div class="order-row"><div style="color: var(--accent);">Продажа</div><div>${o.price}</div><div>${o.volume || o.amount}</div></div>`;
    });
    container.innerHTML = html;
}

function updateProjectStats() {
    const project = platform.projects['millennium-tower'] || { raised: 0, target: 5500000000 };
    const raised = project.raised;
    const target = project.target;
    const percent = (raised / target * 100).toFixed(1);

    const totalRaisedEl = document.getElementById('total-raised');
    const homeRaisedEl = document.getElementById('home-raised');
    const homeProgressBar = document.getElementById('home-progress-bar');
    const homeProgressText = document.getElementById('home-progress-text');
    const projectRaisedDisplay = document.getElementById('project-raised-display-1');
    const projectProgressValue = document.getElementById('project-progress-value-1');
    const circle = document.getElementById('project-progress-circle-1');

    if (totalRaisedEl) totalRaisedEl.innerText = (raised / 1e6).toFixed(1) + 'M';
    if (homeRaisedEl) homeRaisedEl.innerText = '$' + (raised / 1e6).toFixed(1) + 'M';
    if (homeProgressBar) homeProgressBar.style.width = percent + '%';
    if (homeProgressText) homeProgressText.innerText = percent + '% завершено';
    if (projectRaisedDisplay) projectRaisedDisplay.innerText = '$' + (raised / 1e6).toFixed(1) + 'M';
    if (projectProgressValue) projectProgressValue.innerText = percent + '%';
    if (circle) {
        const dashOffset = 126 - (126 * percent / 100);
        circle.setAttribute('stroke-dashoffset', dashOffset);
    }

    const userShares = platform.userData.projectShares?.['millennium-tower'] || 0;
    const userPercent = (userShares / PROJECT_TOTAL_SHARES * 100).toFixed(4);
    const userProfit = calculateUserProfit('millennium-tower');

    const mySharePercentage = document.getElementById('my-share-percentage');
    const myInvestedAmount = document.getElementById('my-invested-amount');
    const myPendingProfit = document.getElementById('my-pending-profit');
    const myProfitShare = document.getElementById('my-profit-share');
    const myProfitUsd = document.getElementById('my-profit-usd');
    const nextProfitEstimate = document.getElementById('next-profit-estimate');

    if (mySharePercentage) mySharePercentage.innerText = userPercent + '%';
    if (myInvestedAmount) myInvestedAmount.innerText = userShares * 1000 + ' SKY';
    if (myPendingProfit) myPendingProfit.innerText = platform.pendingProfit + ' SKY';
    if (myProfitShare) myProfitShare.innerText = platform.pendingProfit + ' SKY';
    if (myProfitUsd) myProfitUsd.innerText = '$' + (platform.pendingProfit * SKY_TO_USD).toFixed(2);
    if (nextProfitEstimate) nextProfitEstimate.innerText = '$' + userProfit.toFixed(2);
}

function updateWithdrawHistory(history) {
    const container = document.getElementById('withdraw-history');
    if (!container) return;
    if (!history || history.length === 0) {
        container.innerHTML = '<div class="no-history">История выводов пуста</div>';
        return;
    }
    let html = '';
    history.forEach(item => {
        const date = item.timestamp ? new Date(item.timestamp.seconds ? item.timestamp.seconds * 1000 : item.timestamp) : new Date();
        const statusText = item.status === 'completed' ? 'Завершено' : item.status === 'pending' ? 'В обработке' : item.status;
        const methodText = item.method === 'crypto' ? 'Криптовалюта' : item.method === 'bank' ? 'Банковская карта' : item.method;

        html += `
            <div class="withdraw-history-item" style="display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 5px; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.1);">
                <div style="font-size: 0.8rem;">${date.toLocaleDateString()}</div>
                <div style="font-size: 0.8rem;">${item.amount} SKY</div>
                <div style="font-size: 0.8rem;">${methodText}</div>
                <div style="font-size: 0.8rem; color: ${item.status === 'completed' ? 'var(--success)' : 'var(--warning)'}">${statusText}</div>
            </div>
        `;
    });
    container.innerHTML = html;
}

// ================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ==================
function calculateUserProfit(projectId) {
    const userSharePercent = calculateUserShare(projectId) / 100;
    return PROJECT_MONTHLY_PROFIT * userSharePercent;
}

function calculateUserShare(projectId) {
    const userShares = platform.userData.projectShares?.[projectId] || 0;
    return (userShares / PROJECT_TOTAL_SHARES) * 100;
}

function calculateNetworkFee(method, amount) {
    return amount * 0.02;
}

function formatTime(timestamp) {
    if (!timestamp) return '';
    const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
    const now = new Date();
    const diff = now - date;
    if (diff < 60000) return 'Только что';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} мин назад`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} ч назад`;
    return date.toLocaleDateString('ru-RU');
}

function updateOnlineUsersCount(count) {
    const countEl = document.getElementById('online-users-count');
    if (countEl) countEl.textContent = count.toLocaleString('ru-RU');
}

function setUserOnline(online) {
    if (currentUser && usersRef) {
        usersRef.doc(currentUser.uid).update({
            online: online,
            lastSeen: firebase.firestore.FieldValue.serverTimestamp()
        }).catch(error => console.error("Ошибка обновления статуса онлайн:", error));
    }
}

function animatePriceChange() {
    document.querySelectorAll('.crypto-price').forEach(el => {
        el.style.transition = 'all 0.5s ease';
        el.style.transform = 'scale(1.1)';
        el.style.color = '#e74c3c';
        setTimeout(() => {
            el.style.transform = 'scale(1)';
            el.style.color = '';
        }, 500);
    });
}

function showSection(sectionId) {
    document.querySelectorAll('.content-section').forEach(section => {
        section.style.display = 'none';
        section.classList.remove('active');
    });
    const targetSection = document.getElementById(sectionId + '-section');
    if (targetSection) {
        targetSection.style.display = 'block';
        targetSection.classList.add('active');
    }
}

function openDepositModal() {
    const modal = document.getElementById('deposit-modal');
    if (modal) {
        modal.style.display = 'flex';
        updateDepositReceive();
    }
}

function updateDepositReceive() {
    const amountUSD = parseFloat(document.getElementById('deposit-usd')?.value) || 0;
    const skyAmount = Math.floor(amountUSD * USD_TO_SKY);
    const receiveEl = document.getElementById('deposit-receive');
    if (receiveEl) receiveEl.innerText = skyAmount.toLocaleString() + ' SKY';
}

// ================== ПОМОЩЬ ==================
function showHelp() {
    let helpModal = document.getElementById('help-modal');
    if (!helpModal) {
        helpModal = document.createElement('div');
        helpModal.id = 'help-modal';
        helpModal.className = 'modal';
        helpModal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3 style="color: var(--secondary);"><i class="fas fa-info-circle"></i> НАВИГАЦИЯ ПО CRYPTOVERSE</h3>
                    <button class="close-modal" onclick="document.getElementById('help-modal').style.display='none'">&times;</button>
                </div>
                <div style="padding: 15px 0; max-height: 60vh; overflow-y: auto;">
                    <!-- Содержимое помощи как в оригинале -->
                </div>
                <div style="text-align: center; margin-top: 15px;">
                    <button class="btn btn-primary" onclick="document.getElementById('help-modal').style.display='none'">
                        <i class="fas fa-check"></i> ПОНЯТНО
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(helpModal);
    }
    helpModal.style.display = 'flex';
}

window.toggleAccordion = function (header) {
    const content = header.nextElementSibling;
    const icon = header.querySelector('i');
    if (content.style.maxHeight && content.style.maxHeight !== '0px') {
        content.style.maxHeight = '0';
        content.style.opacity = '0';
        content.style.marginTop = '0';
        icon.style.transform = 'rotate(0deg)';
    } else {
        content.style.maxHeight = content.scrollHeight + 'px';
        content.style.opacity = '1';
        content.style.marginTop = '8px';
        icon.style.transform = 'rotate(90deg)';
    }
};

// ================== ЗАГРУЗКА ==================
function showLoading(message = "Загрузка...") {
    hideLoading();
    const loadingEl = document.createElement('div');
    loadingEl.id = 'global-loading';
    loadingEl.innerHTML = `
        <div class="loading-overlay">
            <div class="loading-spinner">
                <div class="spinner"></div>
                <div class="loading-text">${message}</div>
            </div>
        </div>
    `;
    const style = document.createElement('style');
    style.textContent = `
        .loading-overlay {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.9);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 9999;
            backdrop-filter: blur(5px);
        }
        .loading-spinner { text-align: center; }
        .spinner {
            width: 50px;
            height: 50px;
            border: 3px solid rgba(0, 201, 255, 0.3);
            border-top: 3px solid var(--secondary);
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin: 0 auto 15px;
        }
        .loading-text { color: var(--secondary); font-size: 1.1rem; animation: pulse 1.5s ease-in-out infinite; }
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
    `;
    document.head.appendChild(style);
    document.body.appendChild(loadingEl);
}

function hideLoading() {
    const loadingEl = document.getElementById('global-loading');
    if (loadingEl) loadingEl.remove();
}

// ================== ГЛОБАЛЬНЫЕ ФУНКЦИИ ДЛЯ ONCLICK ==================
window.showFullProjectDetail = showFullProjectDetail;
window.openWheelGame = openWheelGame;
window.closeWheelGame = closeWheelGame;
window.joinWheelGameModal = joinWheelGameModal;
window.claimProfit = claimProfit;
window.toggleProfitSection = toggleProfitSection;
window.showHelp = showHelp;
window.handleDealAction = handleDealAction;
window.deleteDeal = deleteDeal;
window.markNotificationRead = markNotificationRead;
window.toggleAccordion = toggleAccordion;

// ================== ЗАПУСК ==================
document.addEventListener('DOMContentLoaded', () => {
    showLoading("Инициализация платформы...");
    setTimeout(initPlatform, 500);
});

setTimeout(() => {
    if (document.getElementById('global-loading')) {
        hideLoading();
        showError("Не удалось загрузить приложение. Обновите страницу.");
        initPlatformOffline();
    }
}, 10000);

window.addEventListener('beforeunload', () => setUserOnline(false));
window.addEventListener('focus', () => { if (currentUser) setUserOnline(true); });