// === КОНФИГУРАЦИЯ FIREBASE ===
let firebaseInitialized = false;

// Проверяем, инициализирован ли Firebase
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

    tempData: {
        isOnline: false,
        lastUpdate: Date.now(),
        animationQueue: []
    }
};

// === ОСНОВНАЯ ИНИЦИАЛИЗАЦИЯ ===
async function initPlatform() {
    try {
        console.log("Начало инициализации платформы...");

        // Проверяем Telegram WebApp
        if (window.Telegram && Telegram.WebApp) {
            console.log("Telegram WebApp обнаружен");
            try {
                initTelegramWebApp();
            } catch (tgError) {
                console.warn("Ошибка Telegram WebApp:", tgError);
            }
        }

        // Проверяем Firebase
        if (!firebaseInitialized) {
            console.warn("Firebase не инициализирован, используем оффлайн-режим");
            return initPlatformOffline();
        }

        // Инициализируем Firebase сервисы
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
            
            console.log("Firebase сервисы готовы");
        } catch (firebaseError) {
            console.error("Ошибка Firebase:", firebaseError);
            return initPlatformOffline();
        }

        // Авторизация
        try {
            await initAuth();
        } catch (authError) {
            console.error("Ошибка авторизации:", authError);
            return initPlatformOffline();
        }

        // Загружаем данные
        try {
            await loadInitialData();
        } catch (dataError) {
            console.error("Ошибка загрузки данных:", dataError);
        }

        // Настраиваем обновления
        try {
            setupRealtimeUpdates();
        } catch (updateError) {
            console.error("Ошибка настройки обновлений:", updateError);
        }

        // Инициализируем UI
        initUI();

        // Скрываем загрузку
        hideLoading();

        console.log("Платформа успешно инициализирована");

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
        // Telegram пользователь
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
                    balance: 1000, // Начальный баланс для новых пользователей
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
            // Анонимная авторизация
            await initAnonymousAuth();
        }

        // Обновляем статус онлайн
        setUserOnline(true);

        // Отслеживаем статус подключения
        if (typeof firebase !== 'undefined' && firebase.database) {
            try {
                firebase.database().ref('.info/connected').on('value', (snapshot) => {
                    platform.tempData.isOnline = snapshot.val() === true;
                    updateConnectionStatus();
                });
            } catch (dbError) {
                console.warn("Ошибка отслеживания подключения:", dbError);
            }
        }

    } catch (error) {
        console.error("Ошибка авторизации:", error);
        throw error;
    }
}

// Анонимная авторизация
async function initAnonymousAuth() {
    try {
        const credential = await auth.signInAnonymously();
        currentUser = credential.user;

        await usersRef.doc(currentUser.uid).set({
            id: currentUser.uid,
            username: `user_${Date.now()}`,
            balance: 1000,
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
        // 1. Данные пользователя
        if (currentUser && usersRef) {
            const userDoc = await usersRef.doc(currentUser.uid).get();
            if (userDoc.exists) {
                platform.userData = userDoc.data();
                platform.balance = platform.userData.balance || 0;
            }
        }

        // 2. Проекты
        if (projectsRef) {
            const projectsSnapshot = await projectsRef.get();
            projectsSnapshot.forEach(doc => {
                platform.projects[doc.id] = doc.data();
            });
        }

        // 3. Сделки
        if (dealsRef) {
            const dealsSnapshot = await dealsRef.where('status', '==', 'active').limit(20).get();
            platform.deals = [];
            dealsSnapshot.forEach(doc => {
                platform.deals.push({ id: doc.id, ...doc.data() });
            });
        }

        // 4. Ордеры
        if (ordersRef) {
            const ordersSnapshot = await ordersRef.orderBy('timestamp', 'desc').limit(50).get();
            platform.orders = [];
            ordersSnapshot.forEach(doc => {
                platform.orders.push({ id: doc.id, ...doc.data() });
            });
        }

        // 5. Крипто-цены
        if (cryptoRef) {
            try {
                const cryptoSnapshot = await cryptoRef.doc('prices').get();
                if (cryptoSnapshot.exists) {
                    platform.cryptoPrices = cryptoSnapshot.data();
                } else {
                    // Используем демо-цены
                    platform.cryptoPrices = getDemoCryptoPrices();
                }
            } catch (cryptoError) {
                console.warn("Ошибка загрузки крипто-цен:", cryptoError);
                platform.cryptoPrices = getDemoCryptoPrices();
            }
        } else {
            platform.cryptoPrices = getDemoCryptoPrices();
        }

        // 6. Уведомления
        if (notificationsRef && currentUser) {
            const notificationsSnapshot = await notificationsRef
                .where('userId', '==', currentUser.uid)
                .orderBy('timestamp', 'desc')
                .limit(20)
                .get();

            platform.notifications = [];
            notificationsSnapshot.forEach(doc => {
                platform.notifications.push({ id: doc.id, ...doc.data() });
            });
        }

        console.log("Данные успешно загружены");

    } catch (error) {
        console.error("Ошибка загрузки данных:", error);
        // Используем демо-данные
        platform.balance = 10000;
        platform.userData = { username: "Гость", balance: 10000 };
        platform.cryptoPrices = getDemoCryptoPrices();
        platform.deals = getDemoDeals();
    } finally {
        hideLoading();
    }
}

// === НАСТРОЙКА ОБНОВЛЕНИЙ В РЕАЛЬНОМ ВРЕМЕНИ ===
function setupRealtimeUpdates() {
    if (!firebaseInitialized || !currentUser) return;

    try {
        // 1. Баланс пользователя
        if (usersRef) {
            usersRef.doc(currentUser.uid).onSnapshot((doc) => {
                if (doc.exists) {
                    const data = doc.data();
                    platform.balance = data.balance || 0;
                    updateBalanceDisplay();
                }
            }, (error) => {
                console.error("Ошибка обновления баланса:", error);
            });
        }

        // 2. Сделки
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

        // 3. Крипто-цены
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

        // 4. Уведомления
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
                    console.error("Ошибка обновления уведомлений:", error);
                });
        }

        // 5. Онлайн-пользователи
        if (usersRef) {
            usersRef.where('online', '==', true)
                .onSnapshot((snapshot) => {
                    updateOnlineUsersCount(snapshot.size);
                }, (error) => {
                    console.error("Ошибка обновления онлайн-пользователей:", error);
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
        const skyAmount = Math.floor(amountUSD * 800);

        await usersRef.doc(currentUser.uid).update({
            balance: firebase.firestore.FieldValue.increment(skyAmount),
            totalDeposited: firebase.firestore.FieldValue.increment(amountUSD)
        });

        // Транзакция
        await db.collection('transactions').add({
            userId: currentUser.uid,
            type: 'deposit',
            amount: skyAmount,
            amountUSD: amountUSD,
            status: 'completed',
            timestamp: firebase.firestore.FieldValue.serverTimestamp(),
            method: 'telegram'
        });

        // Уведомление
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

        await db.collection('withdrawals').add(withdrawRequest);

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
    
    // Обновляем отображение данных
    updateBalanceDisplay();
    updateCryptoPricesDisplay();
    updateConnectionStatus();
    
    // Навигация
    const navItems = document.querySelectorAll('.bottom-nav-item');
    if (navItems.length > 0) {
        navItems.forEach(item => {
            item.addEventListener('click', function(e) {
                e.preventDefault();
                const section = this.getAttribute('data-section');
                showSection(section);
                
                navItems.forEach(nav => nav.classList.remove('active'));
                this.classList.add('active');
            });
        });
    }
    
    // Кнопки
    const depositBtn = document.getElementById('btn-deposit');
    if (depositBtn) {
        depositBtn.addEventListener('click', function() {
            const modal = document.getElementById('deposit-modal');
            if (modal) modal.style.display = 'flex';
        });
    }
    
    const notificationBtn = document.getElementById('notification-btn');
    if (notificationBtn) {
        notificationBtn.addEventListener('click', function() {
            const modal = document.getElementById('notification-modal');
            if (modal) modal.style.display = 'flex';
        });
    }
    
    // Закрытие модальных окон
    const closeButtons = document.querySelectorAll('.close-modal');
    closeButtons.forEach(btn => {
        btn.addEventListener('click', function() {
            const modal = this.closest('.modal');
            if (modal) modal.style.display = 'none';
        });
    });
    
    // Закрытие по клику вне модального окна
    window.addEventListener('click', function(e) {
        const modals = document.querySelectorAll('.modal');
        modals.forEach(modal => {
            if (e.target === modal) {
                modal.style.display = 'none';
            }
        });
    });
    
    // Кнопки внутри модальных окон
    initModalButtons();
    
    console.log("Интерфейс инициализирован");
}

// Инициализация кнопок в модальных окнах
function initModalButtons() {
    // Кнопка пополнения
    const depositSubmitBtn = document.getElementById('deposit-submit');
    if (depositSubmitBtn) {
        depositSubmitBtn.addEventListener('click', function() {
            const amountInput = document.getElementById('deposit-amount');
            if (amountInput && amountInput.value) {
                const amount = parseFloat(amountInput.value);
                if (amount > 0) {
                    processDeposit(amount);
                    document.getElementById('deposit-modal').style.display = 'none';
                    amountInput.value = '';
                }
            }
        });
    }
    
    // Кнопка вывода
    const withdrawSubmitBtn = document.getElementById('withdraw-submit');
    if (withdrawSubmitBtn) {
        withdrawSubmitBtn.addEventListener('click', function() {
            const amountInput = document.getElementById('withdraw-amount');
            const methodSelect = document.getElementById('withdraw-method');
            const detailsInput = document.getElementById('withdraw-details');
            
            if (amountInput && amountInput.value) {
                const amount = parseFloat(amountInput.value);
                const method = methodSelect ? methodSelect.value : 'crypto';
                const details = detailsInput ? detailsInput.value : '';
                
                if (amount > 0) {
                    processWithdraw(amount, method, details);
                    document.getElementById('withdraw-modal').style.display = 'none';
                    amountInput.value = '';
                    if (detailsInput) detailsInput.value = '';
                }
            }
        });
    }
}

// === ОФФЛАЙН РЕЖИМ ===
function initPlatformOffline() {
    console.log("Запуск в оффлайн режиме");
    hideLoading();
    
    // Демо-данные
    platform.balance = 10000;
    platform.userData = {
        username: "Гость",
        balance: 10000
    };
    
    platform.cryptoPrices = getDemoCryptoPrices();
    platform.deals = getDemoDeals();
    
    // Обновляем интерфейс
    updateBalanceDisplay();
    updateCryptoPricesDisplay();
    updateDealsList();
    
    // Инициализируем UI
    initUI();
    
    // Уведомление
    setTimeout(() => {
        showNotification("Вы в оффлайн-режиме. Функции ограничены.", "warning");
    }, 500);
    
    console.log("Оффлайн-режим активирован");
}

// === ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ===

// Демо-данные
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
            description: "Продажа DogeMoon токенов"
        },
        {
            id: "demo2",
            type: "buy",
            asset: "pepe",
            quantity: 500,
            price: 8.0,
            userName: "Инвестор",
            description: "Покупка Pepe токенов"
        }
    ];
}

// Уведомления
function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.innerHTML = `
        <div class="notification-content">
            <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : type === 'warning' ? 'exclamation-triangle' : 'info-circle'}"></i>
            ${message}
        </div>
    `;

    document.body.appendChild(notification);

    // Стили
    if (!document.querySelector('#notification-styles')) {
        const style = document.createElement('style');
        style.id = 'notification-styles';
        style.textContent = `
            .notification {
                position: fixed;
                top: 20px;
                right: 20px;
                background: rgba(0, 0, 0, 0.9);
                border-left: 4px solid #3498db;
                padding: 15px 20px;
                border-radius: 8px;
                box-shadow: 0 5px 15px rgba(0,0,0,0.3);
                z-index: 10000;
                animation: slideIn 0.3s ease;
                max-width: 300px;
                color: white;
            }
            .notification.success { border-left-color: #2ecc71; }
            .notification.error { border-left-color: #e74c3c; }
            .notification.warning { border-left-color: #f39c12; }
            .notification-content {
                display: flex;
                align-items: center;
                gap: 10px;
                font-size: 0.9rem;
            }
            @keyframes slideIn {
                from { transform: translateX(100%); opacity: 0; }
                to { transform: translateX(0); opacity: 1; }
            }
            @keyframes slideOut {
                from { transform: translateX(0); opacity: 1; }
                to { transform: translateX(100%); opacity: 0; }
            }
        `;
        document.head.appendChild(style);
    }

    // Автоудаление
    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => notification.remove(), 300);
    }, 5000);
}

function showSuccess(message) {
    showNotification(message, 'success');
}

function showError(message) {
    showNotification(message, 'error');
}

// Создание уведомления в Firebase
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

// Обновление статуса онлайн
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

// Обновление отображения
function updateBalanceDisplay() {
    const balanceEl = document.getElementById('balance');
    const usdEl = document.getElementById('balance-usd');

    if (balanceEl) {
        balanceEl.textContent = platform.balance.toLocaleString('ru-RU') + ' SKY';
    }
    if (usdEl) {
        usdEl.textContent = (platform.balance * 0.00125).toFixed(2) + ' USD';
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
                        <span class="deal-type ${deal.type}">${deal.type === 'buy' ? 'Покупка' : 'Продажа'}</span>
                        <span class="deal-asset">${deal.asset}</span>
                    </div>
                    <div class="deal-info">
                        <div>Количество: ${deal.quantity}</div>
                        <div>Цена: ${deal.price} SKY</div>
                        <div>Продавец: ${deal.userName}</div>
                    </div>
                    <button class="deal-action" onclick="handleDealAction('${deal.id}')">
                        ${deal.type === 'buy' ? 'Купить' : 'Продать'}
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

// Форматирование времени
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

// Показать секцию
function showSection(sectionId) {
    const sections = document.querySelectorAll('.section');
    sections.forEach(section => {
        section.style.display = 'none';
    });
    
    const targetSection = document.getElementById(sectionId);
    if (targetSection) {
        targetSection.style.display = 'block';
    }
}

// Открыть модальное окно пополнения
function openDepositModal() {
    const modal = document.getElementById('deposit-modal');
    if (modal) {
        modal.style.display = 'flex';
    }
}

// Анимация изменения цены
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

// Загрузка
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

// Заглушки для отсутствующих функций
function calculateNetworkFee(method, amount) {
    return amount * 0.02;
}

async function getUserInvestment(projectId) {
    return { share: 0 };
}

async function getUserCryptoHoldings(asset) {
    return 0;
}

async function reserveAssetsForDeal(dealData) {
    console.log("Резервирование активов:", dealData);
}

function handleDealAction(dealId) {
    showNotification("Функция в разработке", "info");
}

// === ЗАПУСК ПРИЛОЖЕНИЯ ===
document.addEventListener('DOMContentLoaded', function() {
    showLoading("Инициализация платформы...");
    
    setTimeout(() => {
        initPlatform();
    }, 1000);
});

// Таймаут загрузки
setTimeout(() => {
    const loadingEl = document.getElementById('global-loading');
    if (loadingEl) {
        hideLoading();
        showError("Не удалось загрузить приложение. Обновите страницу.");
        initPlatformOffline();
    }
}, 10000);

// При закрытии страницы
window.addEventListener('beforeunload', function() {
    setUserOnline(false);
});

// При возвращении на страницу
window.addEventListener('focus', function() {
    if (currentUser) {
        setUserOnline(true);
    }
});