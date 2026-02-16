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

// === ОСНОВНАЯ ИНИЦИАЛИЗАЦИЯ ===
async function initPlatform() {
    try {
        console.log("Начало инициализации платформы...");

        if (window.Telegram && Telegram.WebApp) {
            console.log("Telegram WebApp обнаружен");
            try {
                initTelegramWebApp();
            } catch (tgError) {
                console.warn("Ошибка Telegram WebApp:", tgError);
            }
        }

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
        initAdStats(); // Загружаем статистику рекламы

    } catch (error) {
        console.error("Критическая ошибка инициализации:", error);
        hideLoading();
        showError("Ошибка загрузки. Переход в оффлайн-режим");
        setTimeout(() => {
            initPlatformOffline();
        }, 1000);
    }
}

// === АВТОРИЗАЦИЯ ===
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

        // Удалён код, использующий Realtime Database (он вызывал предупреждение)

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
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            lastSeen: firebase.firestore.FieldValue.serverTimestamp(),
            online: true
        }, { merge: true });
    } catch (error) {
        console.error("Ошибка анонимной авторизации:", error);
        throw error;
    }
}

// === ЗАГРУЗКА ДАННЫХ ===
async function loadInitialData() {
    showLoading("Загрузка данных...");

    try {
        if (currentUser && usersRef) {
            const userDoc = await usersRef.doc(currentUser.uid).get();
            if (userDoc.exists) {
                platform.userData = userDoc.data();
                platform.balance = platform.userData.balance || 0;
                platform.portfolio = platform.userData.portfolio || platform.portfolio;
            }
        }

        // Загрузка проектов
        if (projectsRef) {
            const projectsSnapshot = await projectsRef.get();
            if (projectsSnapshot.empty) {
                platform.projects['millennium-tower'] = {
                    name: 'Башня Тысячелетия',
                    target: 5500000000,
                    raised: 5200000000,
                    yield: 8.3,
                    duration: 15,
                    exitYear: 2035,
                    description: 'Самое высокое здание в мире (1100 м). Офисы, апартаменты, отель.',
                    investors: 24587
                };
            } else {
                projectsSnapshot.forEach(doc => {
                    platform.projects[doc.id] = doc.data();
                });
            }
        } else {
            platform.projects['millennium-tower'] = {
                name: 'Башня Тысячелетия',
                target: 5500000000,
                raised: 5200000000,
                yield: 8.3,
                duration: 15,
                exitYear: 2035,
                description: 'Самое высокое здание в мире (1100 м). Офисы, апартаменты, отель.',
                investors: 24587
            };
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
                console.warn("Не удалось загрузить уведомления (возможно, нужен индекс). Используем демо.");
                platform.notifications = [];
            }
        }

        // Загрузка истории выводов
        await loadWithdrawHistory();

        console.log("Данные успешно загружены");

    } catch (error) {
        console.error("Ошибка загрузки данных:", error);
        platform.balance = 10000;
        platform.userData = { username: "Гость", balance: 10000 };
        platform.cryptoPrices = getDemoCryptoPrices();
        platform.deals = getDemoDeals();
        platform.orders = getDemoOrders();
    } finally {
        hideLoading();
    }
}

// Загрузка истории выводов
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
        console.error("Ошибка загрузки истории выводов (возможно, нужен индекс):", error);
        updateWithdrawHistory([]);
    }
}

// === НАСТРОЙКА ОБНОВЛЕНИЙ В РЕАЛЬНОМ ВРЕМЕНИ ===
function setupRealtimeUpdates() {
    if (!firebaseInitialized || !currentUser) return;

    try {
        if (usersRef) {
            usersRef.doc(currentUser.uid).onSnapshot((doc) => {
                if (doc.exists) {
                    const data = doc.data();
                    platform.balance = data.balance || 0;
                    platform.portfolio = data.portfolio || platform.portfolio;
                    updateBalanceDisplay();
                    updatePortfolioDisplay();
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
                    
                    const unread = platform.notifications.filter(n => !n.read).length;
                    updateNotificationBadge(unread);
                }, (error) => {
                    console.error("Ошибка обновления уведомлений (возможно, нужен индекс):", error);
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
                    console.error("Ошибка обновления истории выводов (возможно, нужен индекс):", error);
                });
        }

    } catch (error) {
        console.error("Ошибка настройки realtime updates:", error);
    }
}

// === ОСНОВНЫЕ ФУНКЦИИ ===

// 1. ПОПОЛНЕНИЕ БАЛАНСА
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

// 2. ВЫВОД СРЕДСТВ
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

// 3. ПОКУПКА ТОКЕНА
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

    updateBalanceDisplay();
    updatePortfolioDisplay();
    updateOrderBook();

    showSuccess(`Куплено ${amount} ${coin.toUpperCase()} за ${total.toFixed(2)} SKY`);
}

// 4. ПРОДАЖА ТОКЕНА
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

    updateBalanceDisplay();
    updatePortfolioDisplay();
    updateOrderBook();

    showSuccess(`Продано ${amount} ${coin.toUpperCase()}, получено ${total.toFixed(2)} SKY`);
}

// === НОВАЯ ФУНКЦИЯ: ИНВЕСТИРОВАНИЕ В ПРОЕКТ ===
function investInProject(projectId, amountSKY) {
    if (!amountSKY || amountSKY <= 0) {
        showError("Введите корректную сумму");
        return;
    }

    const project = platform.projects[projectId];
    if (!project) {
        showError("Проект не найден");
        return;
    }

    // Проверяем достаточно ли средств
    if (amountSKY > platform.balance) {
        showError("Недостаточно средств");
        return;
    }

    // Стоимость одной доли = 1000 SKY (условно)
    const sharesBought = Math.floor(amountSKY / 1000);
    if (sharesBought === 0) {
        showError("Минимальная инвестиция: 1000 SKY");
        return;
    }

    const cost = sharesBought * 1000; // может быть меньше amountSKY, если сумма не кратна 1000

    // Списание баланса
    platform.balance -= cost;

    // Добавление долей в портфель пользователя
    if (!platform.userData.projectShares) platform.userData.projectShares = {};
    platform.userData.projectShares[projectId] = (platform.userData.projectShares[projectId] || 0) + sharesBought;

    // Обновление raised проекта (если нужно)
    project.raised += cost;

    // Сохраняем в Firebase (если онлайн)
    if (firebaseInitialized && currentUser && usersRef) {
        usersRef.doc(currentUser.uid).update({
            balance: platform.balance,
            projectShares: platform.userData.projectShares
        }).catch(err => console.warn("Ошибка синхронизации инвестиций:", err));

        if (projectsRef) {
            projectsRef.doc(projectId).update({
                raised: project.raised
            }).catch(err => console.warn("Ошибка обновления проекта:", err));
        }
    }

    updateBalanceDisplay();
    updateProjectStats();

    showSuccess(`Инвестировано ${cost} SKY, получено ${sharesBought} долей в проекте!`);
}

// === TELEGRAM WEB APP ===
function initTelegramWebApp() {
    try {
        const tg = window.Telegram.WebApp;
        
        tg.expand();
        
        if (tg.BackButton) {
            tg.BackButton.hide();
        }
        
        const theme = tg.colorScheme;
        if (theme === 'dark') {
            document.documentElement.setAttribute('data-theme', 'dark');
        }
        
        if (tg.MainButton) {
            tg.MainButton.setText("Пополнить баланс");
            tg.MainButton.onClick(() => {
                openDepositModal();
            });
        }
        
        tg.ready();
        console.log("Telegram WebApp инициализирован");
    } catch (error) {
        console.warn("Ошибка инициализации Telegram WebApp:", error);
    }
}

// === ИНИЦИАЛИЗАЦИЯ ИНТЕРФЕЙСА ===
function initUI() {
    console.log("Инициализация интерфейса...");
    
    updateBalanceDisplay();
    updateCryptoPricesDisplay();
    updateConnectionStatus();
    updatePortfolioDisplay();
    updateOrderBook();
    updateDealsList();
    updateNotifications();
    updateProjectStats();
    initWheelGame();
    
    // Навигация
    const navItems = document.querySelectorAll('.bottom-nav-item');
    navItems.forEach(item => {
        item.addEventListener('click', function(e) {
            e.preventDefault();
            const section = this.getAttribute('data-section');
            showSection(section);
            
            navItems.forEach(nav => nav.classList.remove('active'));
            this.classList.add('active');
        });
    });
    
    // Кнопка пополнения
    const depositBtn = document.getElementById('btn-deposit');
    if (depositBtn) {
        depositBtn.addEventListener('click', openDepositModal);
    }
    
    // Кнопка уведомлений
    const notificationBtn = document.getElementById('notification-btn');
    if (notificationBtn) {
        notificationBtn.addEventListener('click', function() {
            const modal = document.getElementById('notification-modal');
            if (modal) modal.style.display = 'flex';
        });
    }
    
    // Закрытие модалок
    const closeButtons = document.querySelectorAll('.close-modal');
    closeButtons.forEach(btn => {
        btn.addEventListener('click', function() {
            const modal = this.closest('.modal');
            if (modal) modal.style.display = 'none';
        });
    });
    
    window.addEventListener('click', function(e) {
        const modals = document.querySelectorAll('.modal');
        modals.forEach(modal => {
            if (e.target === modal) {
                modal.style.display = 'none';
            }
        });
    });
    
    // Инициализация всех кнопок
    initActionButtons();
    initExchangeListeners();
    initMarketListeners();
    initWithdrawListeners();

    // Слушатель для поля ввода суммы пополнения
    const depositInput = document.getElementById('deposit-usd');
    if (depositInput) {
        depositInput.addEventListener('input', updateDepositReceive);
    }

    // Кнопка инвестировать (в модалке)
    const investBtn = document.getElementById('btn-invest');
    if (investBtn) {
        investBtn.addEventListener('click', function() {
            const amount = parseFloat(document.getElementById('invest-amount').value);
            if (amount && amount > 0) {
                investInProject('millennium-tower', amount);
                document.getElementById('invest-modal').style.display = 'none';
                document.getElementById('invest-amount').value = '';
            }
        });
    }

    // Кнопка помощи
    const helpBtn = document.querySelector('.help-btn');
    if (helpBtn) {
        helpBtn.addEventListener('click', showHelp);
    }
    
    console.log("Интерфейс инициализирован");
}

// Обновление поля "Вы получите" в модалке пополнения
function updateDepositReceive() {
    const amountUSD = parseFloat(document.getElementById('deposit-usd').value) || 0;
    const skyAmount = Math.floor(amountUSD * USD_TO_SKY);
    document.getElementById('deposit-receive').innerText = skyAmount.toLocaleString() + ' SKY';
}

// === ИНИЦИАЛИЗАЦИЯ КНОПОК ===
function initActionButtons() {
    // Кнопки в модалках
    const depositSubmitBtn = document.getElementById('btn-process-deposit');
    if (depositSubmitBtn) {
        depositSubmitBtn.addEventListener('click', function() {
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
    }

    const withdrawSubmitBtn = document.getElementById('btn-withdraw');
    if (withdrawSubmitBtn) {
        withdrawSubmitBtn.addEventListener('click', function() {
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
    }

    const clearNotificationsBtn = document.getElementById('btn-clear-all-notifications');
    if (clearNotificationsBtn) {
        clearNotificationsBtn.addEventListener('click', function() {
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
    }

    const buyBtn = document.getElementById('btn-buy');
    if (buyBtn) {
        buyBtn.addEventListener('click', function() {
            const coin = platform.tempData.selectedCoin;
            const amount = parseFloat(document.getElementById('buy-amount').value);
            buyToken(coin, amount);
        });
    }

    const sellBtn = document.getElementById('btn-sell');
    if (sellBtn) {
        sellBtn.addEventListener('click', function() {
            const coin = platform.tempData.selectedCoin;
            const amount = parseFloat(document.getElementById('sell-amount').value);
            sellToken(coin, amount);
        });
    }

    const createDealBtn = document.getElementById('btn-create-deal');
    if (createDealBtn) {
        createDealBtn.addEventListener('click', createDeal);
    }

    const searchDealsBtn = document.getElementById('btn-search-deals');
    if (searchDealsBtn) {
        searchDealsBtn.addEventListener('click', filterDeals);
    }

    const watchAdBtn = document.getElementById('btn-watch-random-ad');
    if (watchAdBtn) {
        watchAdBtn.addEventListener('click', watchAd);
    }

    // Кнопка открытия модалки инвестирования (на главной)
    const investNowBtn = document.getElementById('btn-invest-now');
    if (investNowBtn) {
        investNowBtn.addEventListener('click', function() {
            document.getElementById('invest-modal').style.display = 'flex';
        });
    }
}

// === СЛУШАТЕЛИ ДЛЯ БИРЖИ ===
function initExchangeListeners() {
    const cryptoCards = document.querySelectorAll('.crypto-card');
    cryptoCards.forEach(card => {
        card.addEventListener('click', function() {
            const coin = this.getAttribute('data-coin');
            if (coin) {
                platform.tempData.selectedCoin = coin;
                cryptoCards.forEach(c => c.classList.remove('selected'));
                this.classList.add('selected');
                updateExchangeFields(coin);
            }
        });
    });

    const buyAmount = document.getElementById('buy-amount');
    if (buyAmount) {
        buyAmount.addEventListener('input', updateBuyCost);
    }

    const sellAmount = document.getElementById('sell-amount');
    if (sellAmount) {
        sellAmount.addEventListener('input', updateSellRevenue);
    }
}

function updateExchangeFields(coin) {
    const price = platform.cryptoPrices[coin] || 0;
    document.getElementById('buy-price-display').innerText = price + ' SKY';
    document.getElementById('buy-price').value = price;
    document.getElementById('sell-price-display').innerText = price + ' SKY';
    document.getElementById('sell-price').value = price;
    document.getElementById('buy-coin-name').innerText = coin.toUpperCase();
    document.getElementById('sell-coin-name').innerText = coin.toUpperCase();

    updateBuyCost();
    updateSellRevenue();
}

function updateBuyCost() {
    const amount = parseFloat(document.getElementById('buy-amount').value) || 0;
    const price = parseFloat(document.getElementById('buy-price').value) || 0;
    const cost = amount * price;
    const fee = cost * 0.005;
    const total = cost + fee;
    document.getElementById('buy-cost').innerText = total.toFixed(2) + ' SKY';
    document.getElementById('buy-fee').innerText = fee.toFixed(2) + ' SKY';
}

function updateSellRevenue() {
    const amount = parseFloat(document.getElementById('sell-amount').value) || 0;
    const price = parseFloat(document.getElementById('sell-price').value) || 0;
    const revenue = amount * price;
    const fee = revenue * 0.005;
    const total = revenue - fee;
    document.getElementById('sell-revenue').innerText = total.toFixed(2) + ' SKY';
    document.getElementById('sell-fee').innerText = fee.toFixed(2) + ' SKY';
}

// === СЛУШАТЕЛИ ДЛЯ РЫНКА (СДЕЛКИ) ===
function initMarketListeners() {
    const dealType = document.getElementById('deal-type');
    const dealAsset = document.getElementById('deal-asset');
    const dealQuantity = document.getElementById('deal-quantity');
    const dealPrice = document.getElementById('deal-price');

    if (dealType) dealType.addEventListener('change', updateDealSummary);
    if (dealAsset) dealAsset.addEventListener('change', updateDealSummary);
    if (dealQuantity) dealQuantity.addEventListener('input', updateDealSummary);
    if (dealPrice) dealPrice.addEventListener('input', updateDealSummary);

    const filterType = document.getElementById('filter-type');
    const filterAsset = document.getElementById('filter-asset');
    const filterMaxPrice = document.getElementById('filter-max-price');

    if (filterType) filterType.addEventListener('change', filterDeals);
    if (filterAsset) filterAsset.addEventListener('change', filterDeals);
    if (filterMaxPrice) filterMaxPrice.addEventListener('input', filterDeals);
}

function updateDealSummary() {
    const type = document.getElementById('deal-type').value;
    const assetSelect = document.getElementById('deal-asset');
    const assetText = assetSelect.options[assetSelect.selectedIndex].text;
    const quantity = parseFloat(document.getElementById('deal-quantity').value) || 0;
    const price = parseFloat(document.getElementById('deal-price').value) || 0;
    const total = quantity * price;

    document.getElementById('deal-summary-type').innerText = type === 'sell' ? 'Продажа' : 'Покупка';
    document.getElementById('deal-summary-asset').innerText = assetText;
    document.getElementById('deal-summary-quantity').innerText = quantity + ' шт.';
    document.getElementById('deal-summary-price').innerText = price + ' SKY';
    document.getElementById('deal-summary-total').innerText = total.toFixed(2) + ' SKY';
}

function createDeal() {
    const type = document.getElementById('deal-type').value;
    const asset = document.getElementById('deal-asset').value;
    const quantity = parseFloat(document.getElementById('deal-quantity').value);
    const price = parseFloat(document.getElementById('deal-price').value);
    const partial = document.getElementById('deal-partial').value === 'yes';
    const description = document.getElementById('deal-description').value;

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
    document.getElementById('deal-quantity').value = 1;
    document.getElementById('deal-price').value = 1;
    document.getElementById('deal-description').value = '';
    updateDealSummary();
}

function filterDeals() {
    const type = document.getElementById('filter-type').value;
    const asset = document.getElementById('filter-asset').value;
    const maxPrice = parseFloat(document.getElementById('filter-max-price').value) || Infinity;

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
        html += `
            <div class="deal-item">
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
                <button class="btn btn-primary deal-action" onclick="handleDealAction('${deal.id}')">${deal.type === 'buy' ? 'Продать' : 'Купить'}</button>
            </div>
        `;
    });
    container.innerHTML = html;
}

function handleDealAction(dealId) {
    const deal = platform.deals.find(d => d.id === dealId);
    if (!deal) return;

    if (deal.type === 'sell') {
        if (deal.userId === (currentUser ? currentUser.uid : 'guest')) {
            showError("Нельзя купить собственную сделку");
            return;
        }

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

        platform.deals = platform.deals.filter(d => d.id !== dealId);
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

        platform.deals = platform.deals.filter(d => d.id !== dealId);
        updateDealsList();
        updateBalanceDisplay();
        updatePortfolioDisplay();

        showSuccess("Сделка выполнена");
    }
}

// === СЛУШАТЕЛИ ДЛЯ ВЫВОДА ===
function initWithdrawListeners() {
    const methodSelect = document.getElementById('withdraw-method');
    const cryptoDetails = document.getElementById('crypto-details');
    const cardDetails = document.getElementById('card-details');
    const amountInput = document.getElementById('withdraw-amount');

    if (methodSelect) {
        methodSelect.addEventListener('change', function() {
            const val = this.value;
            if (cryptoDetails) cryptoDetails.style.display = val === 'crypto' ? 'block' : 'none';
            if (cardDetails) cardDetails.style.display = (val === 'bank' || val === 'yoomoney' || val === 'qiwi') ? 'block' : 'none';
        });
    }

    if (amountInput) {
        amountInput.addEventListener('input', updateWithdrawSummary);
    }

    const networkSelect = document.getElementById('crypto-network');
    if (networkSelect) {
        networkSelect.addEventListener('change', updateWithdrawSummary);
    }
}

function updateWithdrawSummary() {
    const amount = parseFloat(document.getElementById('withdraw-amount').value) || 0;
    const method = document.getElementById('withdraw-method').value;
    const network = document.getElementById('crypto-network')?.value || 'trc20';

    let networkFeePercent = 0.02;
    if (network === 'trc20') networkFeePercent = 0.01;
    else if (network === 'erc20') networkFeePercent = 0.03;
    else if (network === 'bep20') networkFeePercent = 0.005;

    const feePlatform = amount * 0.01;
    const feeNetwork = amount * networkFeePercent;
    const total = amount - feePlatform - feeNetwork;

    document.getElementById('withdraw-summary-amount').innerText = amount.toFixed(2);
    document.getElementById('withdraw-usd').innerText = (amount * SKY_TO_USD).toFixed(2);
    document.getElementById('withdraw-fee-platform').innerText = feePlatform.toFixed(2) + ' SKY';
    document.getElementById('withdraw-fee-network').innerText = feeNetwork.toFixed(2) + ' SKY';
    document.getElementById('withdraw-total').innerText = total.toFixed(2);
    document.getElementById('withdraw-total-usd').innerText = (total * SKY_TO_USD).toFixed(2);
}

// === ПРОСМОТР РЕКЛАМЫ (ИСПРАВЛЕНО) ===
function watchAd() {
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
    
    // Обновление статистики на странице
    const totalEarnedToday = watched * 3;
    let totalEarnedAll = parseInt(localStorage.getItem('total_earned') || '0') + 3;
    localStorage.setItem('total_earned', totalEarnedAll);

    document.getElementById('ads-watched').innerText = watched + '/50';
    document.getElementById('earned-today').innerText = totalEarnedToday + ' SKY';
    document.getElementById('total-earned').innerText = totalEarnedAll + ' SKY';
}

// Инициализация статистики рекламы при загрузке
function initAdStats() {
    const watched = parseInt(localStorage.getItem('ads_watched_today') || '0');
    const totalEarned = parseInt(localStorage.getItem('total_earned') || '0');
    document.getElementById('ads-watched').innerText = watched + '/50';
    document.getElementById('earned-today').innerText = (watched * 3) + ' SKY';
    document.getElementById('total-earned').innerText = totalEarned + ' SKY';
}

// === ДЕТАЛИ ПРОЕКТА ===
function showFullProjectDetail(projectId) {
    let project = platform.projects[projectId];
    if (!project) {
        console.warn("Проект не найден, использую демо-данные");
        project = {
            name: 'Башня Тысячелетия',
            target: 5500000000,
            raised: 5200000000,
            yield: 8.3,
            duration: 15,
            exitYear: 2035,
            description: 'Самое высокое здание в мире (1100 м). Офисы, апартаменты, отель.',
            investors: 24587
        };
    }

    const modal = document.getElementById('project-detail-modal');
    const content = document.getElementById('project-detail-content');

    const raised = project.raised || 0;
    const target = project.target || 1;
    const percent = (raised / target * 100).toFixed(1);

    const userShare = platform.userData.projectShares?.[projectId] || 0;
    const totalShares = 1000000;
    const userPercent = (userShare / totalShares * 100).toFixed(2);

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
                <span>Прогрес сбора:</span>
                <span style="color: var(--success);">${percent}%</span>
            </div>
            <div style="height: 8px; background: rgba(255,255,255,0.1); border-radius: 4px;">
                <div style="width: ${percent}%; height: 100%; background: linear-gradient(90deg, var(--secondary), var(--success)); border-radius: 4px;"></div>
            </div>
        </div>

        <div class="share-chart-wrapper">
            <div class="share-chart-info">
                <h5 style="color: var(--secondary); margin-bottom: 10px;">Ваша доля</h5>
                <div style="font-size: 1.5rem; color: var(--success);">${userShare.toLocaleString()}</div>
                <div style="color: var(--gray);">долей (${userPercent}%)</div>
            </div>
            <div class="share-sell-note">
                <h5><i class="fas fa-info-circle"></i> Условия выхода</h5>
                <p style="font-size: 0.9rem; color: var(--gray);">После 2035 года вы сможете продать долю обратно компании за 125% от стоимости инвестиций. Досрочная продажа доступна на рынке.</p>
            </div>
        </div>
    `;

    modal.style.display = 'flex';
}

// === КОЛЕСО ВЕЗЕНИЯ ===
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

        document.getElementById('casino-total-wins').innerText = (parseInt(document.getElementById('casino-total-wins').innerText) + 1).toString();
        document.getElementById('casino-total-won').innerText = (parseInt(document.getElementById('casino-total-won').innerText) + prize).toString() + ' SKY';
        if (prize > parseInt(document.getElementById('casino-biggest-win').innerText)) {
            document.getElementById('casino-biggest-win').innerText = prize + ' SKY';
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
    const bet = parseFloat(document.getElementById('wheel-bet-modal').value);
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

    document.getElementById('wheel-players-count-modal').innerText = players.length;
    document.getElementById('wheel-total-bet-modal').innerText = totalBet;
    document.getElementById('wheel-prize-modal').innerText = `Призовой фонд: ${Math.floor(prizePool * 0.95)} SKY`;

    const playersList = document.getElementById('wheel-players-modal');
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

    document.getElementById('wheel-players-count-preview').innerText = players.length;
}

// === ПРИБЫЛЬ ПО ПРОЕКТУ ===
function claimProfit(projectId) {
    if (platform.pendingProfit > 0) {
        platform.balance += platform.pendingProfit;
        platform.pendingProfit = 0;
        updateBalanceDisplay();
        document.getElementById('my-pending-profit').innerText = '0 SKY';
        showSuccess("Прибыль получена!");
    } else {
        showNotification("Нет доступной прибыли", "info");
    }
}

function toggleProfitSection() {
    const content = document.getElementById('profit-content');
    const btn = document.getElementById('profit-toggle-btn').querySelector('i');
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

// === ТАЙМЕР ВЫПЛАТЫ ===
function startPayoutTimer() {
    setInterval(updatePayoutTimer, 1000);
}

function updatePayoutTimer() {
    const now = new Date();
    const next = new Date(platform.nextPayoutDate);
    const diff = next - now;
    if (diff <= 0) {
        platform.pendingProfit += 250;
        platform.nextPayoutDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
        updateProjectStats();
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

// === ОФФЛАЙН РЕЖИМ ===
function initPlatformOffline() {
    console.log("Запуск в оффлайн режиме");
    hideLoading();
    
    platform.balance = 10000;
    platform.userData = {
        username: "Гость",
        balance: 10000,
        projectShares: { 'millennium-tower': 10 }
    };
    platform.pendingProfit = 250;
    
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
    
    setTimeout(() => {
        showNotification("Вы в оффлайн-режиме. Функции ограничены.", "warning");
    }, 500);
    
    console.log("Оффлайн-режим активирован");
}

// === ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ===

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

function showNotification(message, type = 'info') {
    // Простая реализация уведомлений
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

// Новая функция для кнопки помощи
function showHelp() {
    alert("Добро пожаловать в CRYPTOVERSE!\n\nБаланс: " + platform.balance + " SKY\n\nЕсли у вас возникли вопросы, обратитесь в поддержку: support@cryptoverse.com");
}

async function createNotification(userId, title, message, type = 'info') {
    if (!firebaseInitialized || !notificationsRef) {
        console.log("Оффлайн: уведомление не отправлено", { title, message });
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

function setUserOnline(online) {
    if (currentUser && usersRef) {
        usersRef.doc(currentUser.uid).update({
            online: online,
            lastSeen: firebase.firestore.FieldValue.serverTimestamp()
        }).catch(error => {
            console.error("Ошибка обновления статуса онлайн:", error);
        });
    }
}

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

function updateConnectionStatus() {
    const statusEl = document.getElementById('connection-status');
    if (statusEl) {
        statusEl.textContent = platform.tempData.isOnline ? '🟢 В сети' : '🔴 Офлайн';
        statusEl.className = platform.tempData.isOnline ? 'online' : 'offline';
    }
}

function updateOnlineUsersCount(count) {
    const countEl = document.getElementById('online-users-count');
    if (countEl) {
        countEl.textContent = count.toLocaleString('ru-RU');
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
    if (container) {
        if (platform.deals.length === 0) {
            container.innerHTML = '<div class="no-deals">Нет активных сделок</div>';
            return;
        }
        
        let html = '';
        platform.deals.forEach(deal => {
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
                    <button class="deal-action btn btn-primary" onclick="handleDealAction('${deal.id}')">
                        ${deal.type === 'buy' ? 'Продать' : 'Купить'}
                    </button>
                </div>
            `;
        });
        container.innerHTML = html;
    }
}

function updateNotifications() {
    const container = document.getElementById('notifications-container');
    if (container) {
        if (platform.notifications.length === 0) {
            container.innerHTML = '<div class="no-notifications">Нет уведомлений</div>';
            return;
        }
        
        let html = '';
        platform.notifications.forEach(notif => {
            html += `
                <div class="notification-item ${notif.type} ${notif.read ? 'read' : 'unread'}">
                    <div class="notification-title">${notif.title}</div>
                    <div class="notification-message">${notif.message}</div>
                    <div class="notification-time">${formatTime(notif.timestamp)}</div>
                </div>
            `;
        });
        container.innerHTML = html;
    }
}

function updateNotificationBadge(count) {
    const badge = document.getElementById('notification-badge');
    if (badge) {
        badge.textContent = count > 9 ? '9+' : count;
        badge.style.display = count > 0 ? 'flex' : 'none';
    }
}

function formatTime(timestamp) {
    if (!timestamp) return '';
    
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    const now = new Date();
    const diff = now - date;
    
    if (diff < 60000) return 'Только что';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} мин назад`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} ч назад`;
    
    return date.toLocaleDateString('ru-RU');
}

function showSection(sectionId) {
    const sections = document.querySelectorAll('.content-section');
    sections.forEach(section => {
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

function animatePriceChange() {
    const priceElements = document.querySelectorAll('.crypto-price');
    priceElements.forEach(el => {
        el.style.transition = 'all 0.5s ease';
        el.style.transform = 'scale(1.1)';
        el.style.color = '#e74c3c';

        setTimeout(() => {
            el.style.transform = 'scale(1)';
            el.style.color = '';
        }, 500);
    });
}

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
    document.body.appendChild(loadingEl);
}

function hideLoading() {
    const loadingEl = document.getElementById('global-loading');
    if (loadingEl) {
        loadingEl.remove();
    }
}

function calculateNetworkFee(method, amount) {
    return amount * 0.02;
}

// === ОБНОВЛЕНИЕ ПОРТФЕЛЯ И КНИГИ ОРДЕРОВ ===
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

    const buyOrders = platform.orders.filter(o => o.type === 'buy').sort((a,b) => b.price - a.price);
    const sellOrders = platform.orders.filter(o => o.type === 'sell').sort((a,b) => a.price - b.price);

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
    const project = platform.projects['millennium-tower'] || { raised: 5200000000, target: 5500000000 };
    const raised = project.raised;
    const target = project.target;
    const percent = (raised / target * 100).toFixed(1);

    document.getElementById('total-raised').innerText = (raised / 1e6).toFixed(1) + 'M';
    document.getElementById('home-raised').innerText = '$' + (raised / 1e6).toFixed(1) + 'M';
    document.getElementById('home-progress-bar').style.width = percent + '%';
    document.getElementById('home-progress-text').innerText = percent + '% завершено';
    document.getElementById('project-raised-display-1').innerText = '$' + (raised / 1e6).toFixed(1) + 'M';
    document.getElementById('project-progress-value-1').innerText = percent + '%';
    const circle = document.getElementById('project-progress-circle-1');
    if (circle) {
        const dashOffset = 126 - (126 * percent / 100);
        circle.setAttribute('stroke-dashoffset', dashOffset);
    }

    const userShare = platform.userData.projectShares?.['millennium-tower'] || 10;
    const totalShares = 1000000;
    const userPercent = (userShare / totalShares * 100).toFixed(2);
    document.getElementById('my-share-percentage').innerText = userPercent + '%';
    document.getElementById('my-invested-amount').innerText = userShare * 1000 + ' SKY';
    document.getElementById('my-pending-profit').innerText = platform.pendingProfit + ' SKY';
    document.getElementById('my-profit-share').innerText = platform.pendingProfit + ' SKY';
    document.getElementById('my-profit-usd').innerText = '$' + (platform.pendingProfit * SKY_TO_USD).toFixed(2);
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
        html += `
            <div class="withdraw-history-item">
                <div>${date.toLocaleDateString()}</div>
                <div>${item.amount} SKY</div>
                <div>${item.method}</div>
                <div style="color: ${item.status === 'completed' ? 'var(--success)' : 'var(--warning)'}">${item.status}</div>
            </div>
        `;
    });
    container.innerHTML = html;
}

// === ЗАПУСК ПРИЛОЖЕНИЯ ===
document.addEventListener('DOMContentLoaded', function() {
    showLoading("Инициализация платформы...");
    
    setTimeout(() => {
        initPlatform();
    }, 1000);
});

setTimeout(() => {
    const loadingEl = document.getElementById('global-loading');
    if (loadingEl) {
        hideLoading();
        showError("Не удалось загрузить приложение. Обновите страницу.");
        initPlatformOffline();
    }
}, 10000);

window.addEventListener('beforeunload', function() {
    setUserOnline(false);
});

window.addEventListener('focus', function() {
    if (currentUser) {
        setUserOnline(true);
    }
});