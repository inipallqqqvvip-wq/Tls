(function() {
    'use strict';

    // ============ KONFIGURASI ============
    const TIMEOUT_DB_IDLE = 3000;           // ms tanpa koneksi DB baru => dianggap selesai
    const LOG_GITHUB = true;                // tampilkan log akses GitHub
    const LOG_DB = true;                    // tampilkan log koneksi DB
    const AUTO_KILL_GITHUB = true;          // true = matikan proses jika akses GitHub terdeteksi
    const FORCE_KILL = true;                // true = gunakan SIGKILL untuk mematikan paksa
    const GITHUB_DOMAINS = [
        'github.com',
        'raw.githubusercontent.com',
        'api.github.com',
        'gist.github.com',
        'githubusercontent.com'
    ];

    // ============ VARIABEL GLOBAL ============
    const detectedDBs = [];
    let dbTimeoutId = null;
    let isExiting = false;

    // ============ FUNGSI UTILITY ============
    function isGithubUrl(url) {
        if (!url) return false;
        const lower = url.toLowerCase();
        return GITHUB_DOMAINS.some(domain => lower.includes(domain));
    }

    function logDB(config, source) {
        const entry = { source, config, timestamp: new Date() };
        detectedDBs.push(entry);
        if (LOG_DB) {
            console.log(`\x1b[36m[DARK DB] ${source}:\x1b[0m`, JSON.stringify(config, null, 2));
        }
        resetDBTimer();
    }

    function resetDBTimer() {
        if (dbTimeoutId) clearTimeout(dbTimeoutId);
        dbTimeoutId = setTimeout(() => {
            if (isExiting) return;
            console.log(`\x1b[32m[DARK] Tidak ada koneksi DB baru dalam ${TIMEOUT_DB_IDLE} ms. Semua DB terdeteksi.\x1b[0m`);
            console.log(`\x1b[33m[DARK] Total koneksi DB: ${detectedDBs.length}\x1b[0m`);
            if (detectedDBs.length > 0) {
                console.log('\x1b[33m[DARK] Detail semua DB:\x1b[0m');
                detectedDBs.forEach((entry, i) => {
                    console.log(`  ${i+1}. ${entry.source} =>`, entry.config);
                });
            } else {
                console.log('[DARK] Tidak ada koneksi database yang terdeteksi.');
            }
            forceKill();
        }, TIMEOUT_DB_IDLE);
    }

    // ============ FORCE KILL ============
    function forceKill() {
        if (isExiting) return;
        isExiting = true;
        console.error('\x1b[31m[DARK] ☠️  Mematikan proses secara paksa...\x1b[0m');
        if (FORCE_KILL) {
            try {
                process.kill(process.pid, 'SIGKILL');
            } catch (e) {
                // Fallback
                process.exit(1);
            }
        } else {
            global.__MY_EXIT_FLAG = true;
            process.exit(0);
        }
    }

    // ============ OVERRIDE exit/kill (cegah proteksi lain) ============
    const originalExit = process.exit;
    const originalKill = process.kill;
    process.exit = function(code) {
        if (global.__MY_EXIT_FLAG) {
            return originalExit(code);
        }
        console.warn('[DARK] process.exit dicegah (bukan dari deteksi kami)');
        // Jika ada yang mencoba exit, kita lawan dengan force kill
        forceKill();
    };
    process.kill = function(pid, signal) {
        if (pid === process.pid) {
            console.warn('[DARK] process.kill dicegah untuk PID sendiri');
            // Cegah bunuh diri, tapi jika signal SIGKILL kita biarkan?
            if (signal === 'SIGKILL') {
                // Biarkan jika memang dari kita
                return originalKill(pid, signal);
            }
            return;
        }
        return originalKill(pid, signal);
    };

    // ============ HIJACK GITHUB (tanpa interceptor) ============
    function hijackGithub() {
        // ----- 1. AXIOS (patch method langsung) -----
        try {
            const axios = require('axios');
            const originalMethods = {
                request: axios.request,
                get: axios.get,
                post: axios.post,
                put: axios.put,
                patch: axios.patch,
                delete: axios.delete,
                head: axios.head,
                options: axios.options
            };

            function wrapMethod(fn, name) {
                return function(...args) {
                    let url = '';
                    if (args.length > 0 && typeof args[0] === 'string') {
                        url = args[0];
                    } else if (args.length > 0 && args[0] && typeof args[0] === 'object') {
                        url = args[0].url || '';
                    }
                    if (name === 'request' && args.length > 0 && typeof args[0] === 'object') {
                        url = args[0].url || '';
                    }
                    if (isGithubUrl(url)) {
                        if (LOG_GITHUB) console.warn(`\x1b[33m[DARK] axios.${name} → ${url}\x1b[0m`);
                        if (AUTO_KILL_GITHUB) forceKill();
                    }
                    return fn.apply(this, args);
                };
            }

            axios.request = wrapMethod(originalMethods.request, 'request');
            axios.get = wrapMethod(originalMethods.get, 'get');
            axios.post = wrapMethod(originalMethods.post, 'post');
            axios.put = wrapMethod(originalMethods.put, 'put');
            axios.patch = wrapMethod(originalMethods.patch, 'patch');
            axios.delete = wrapMethod(originalMethods.delete, 'delete');
            axios.head = wrapMethod(originalMethods.head, 'head');
            axios.options = wrapMethod(originalMethods.options, 'options');

            const originalCreate = axios.create;
            axios.create = function(config) {
                const instance = originalCreate(config);
                const origInstanceMethods = {
                    request: instance.request,
                    get: instance.get,
                    post: instance.post,
                    put: instance.put,
                    patch: instance.patch,
                    delete: instance.delete,
                    head: instance.head,
                    options: instance.options
                };
                instance.request = wrapMethod(origInstanceMethods.request, 'create.request');
                instance.get = wrapMethod(origInstanceMethods.get, 'create.get');
                instance.post = wrapMethod(origInstanceMethods.post, 'create.post');
                instance.put = wrapMethod(origInstanceMethods.put, 'create.put');
                instance.patch = wrapMethod(origInstanceMethods.patch, 'create.patch');
                instance.delete = wrapMethod(origInstanceMethods.delete, 'create.delete');
                instance.head = wrapMethod(origInstanceMethods.head, 'create.head');
                instance.options = wrapMethod(origInstanceMethods.options, 'create.options');
                return instance;
            };

            const Module = require('module');
            const axiosPath = require.resolve('axios');
            if (Module._cache[axiosPath]) {
                Module._cache[axiosPath].exports = axios;
            }
            global.axios = axios;
        } catch (e) {}

        // ----- 2. HTTP / HTTPS -----
        function hijackProtocol(protocol, mod) {
            const origRequest = mod.request;
            mod.request = function(options, ...args) {
                let url = '';
                if (typeof options === 'string') url = options;
                else if (options?.href) url = options.href;
                else if (options && (options.host || options.hostname)) {
                    const host = options.host || options.hostname;
                    const path = options.path || '/';
                    const proto = options.protocol || protocol + ':';
                    url = proto + '//' + host + path;
                }
                if (isGithubUrl(url)) {
                    if (LOG_GITHUB) console.warn(`\x1b[33m[DARK] ${protocol} → ${url}\x1b[0m`);
                    if (AUTO_KILL_GITHUB) forceKill();
                }
                return origRequest.call(this, options, ...args);
            };
            mod.get = function(options, ...args) {
                let url = '';
                if (typeof options === 'string') url = options;
                else if (options?.href) url = options.href;
                else if (options && (options.host || options.hostname)) {
                    const host = options.host || options.hostname;
                    const path = options.path || '/';
                    const proto = options.protocol || protocol + ':';
                    url = proto + '//' + host + path;
                }
                if (isGithubUrl(url)) {
                    if (LOG_GITHUB) console.warn(`\x1b[33m[DARK] ${protocol}.get → ${url}\x1b[0m`);
                    if (AUTO_KILL_GITHUB) forceKill();
                }
                return origRequest.call(this, options, ...args);
            };
        }
        try { hijackProtocol('http', require('http')); } catch (e) {}
        try { hijackProtocol('https', require('https')); } catch (e) {}

        // ----- 3. FETCH -----
        if (typeof global.fetch === 'function') {
            const origFetch = global.fetch;
            global.fetch = function(input, init) {
                let url = '';
                if (typeof input === 'string') url = input;
                else if (input?.url) url = input.url;
                if (isGithubUrl(url)) {
                    if (LOG_GITHUB) console.warn(`\x1b[33m[DARK] fetch → ${url}\x1b[0m`);
                    if (AUTO_KILL_GITHUB) forceKill();
                }
                return origFetch.call(this, input, init);
            };
        }
    }

    // ============ HIJACK DATABASE ============
    function hijackDatabase() {
        function parseConfig(arg, source) {
            if (typeof arg === 'string') {
                try {
                    const url = new URL(arg);
                    const config = {
                        host: url.hostname,
                        port: url.port || (source.includes('mongo') ? 27017 : (source.includes('redis') ? 6379 : 3306)),
                        database: url.pathname.slice(1) || undefined,
                        user: url.username || undefined,
                        password: url.password ? '***' : undefined,
                        fullUrl: arg
                    };
                    return config;
                } catch (e) {
                    return { fullUrl: arg };
                }
            }
            if (arg && typeof arg === 'object') {
                const config = { ...arg };
                if (config.password) config.password = '***';
                if (config.url) config.fullUrl = config.url;
                return config;
            }
            return {};
        }

        function hookModule(moduleName, hookFn) {
            try {
                const mod = require(moduleName);
                if (!mod) return;
                const newMod = new Proxy(mod, {
                    get(target, prop) {
                        const originalProp = target[prop];
                        if (typeof originalProp === 'function') {
                            return function(...args) {
                                const config = hookFn(prop, args);
                                if (config) {
                                    logDB(config, moduleName + '.' + prop);
                                }
                                return originalProp.apply(target, args);
                            };
                        }
                        return originalProp;
                    }
                });
                const Module = require('module');
                try {
                    const modPath = require.resolve(moduleName);
                    if (Module._cache[modPath]) {
                        Module._cache[modPath].exports = newMod;
                    }
                } catch (e) {}
                if (global[moduleName]) global[moduleName] = newMod;
            } catch (e) {}
        }

        function hookMysql(prop, args) {
            if (['createConnection', 'createPool'].includes(prop)) {
                return parseConfig(args[0], 'mysql');
            }
            return null;
        }
        function hookPg(prop, args) {
            if (['Client', 'Pool'].includes(prop)) {
                return parseConfig(args[0] || {}, 'pg');
            }
            return null;
        }
        function hookMongo(prop, args) {
            if (prop === 'connect') {
                const url = args[0];
                const options = args[1] || {};
                const config = parseConfig(url, 'mongodb');
                config.options = options;
                return config;
            }
            return null;
        }
        function hookRedis(prop, args) {
            if (prop === 'createClient') {
                return parseConfig(args[0] || {}, 'redis');
            }
            return null;
        }
        function hookSequelize(prop, args) {
            if (prop === 'Sequelize') {
                let config = {};
                if (args.length === 1 && typeof args[0] === 'string') {
                    config = parseConfig(args[0], 'sequelize');
                } else if (args.length >= 2) {
                    config = { database: args[0], username: args[1], password: args[2] ? '***' : undefined, options: args[3] };
                }
                return config;
            }
            return null;
        }

        const modules = [
            { name: 'mysql', hook: hookMysql },
            { name: 'mysql2', hook: hookMysql },
            { name: 'pg', hook: hookPg },
            { name: 'mongodb', hook: hookMongo },
            { name: 'redis', hook: hookRedis },
            { name: 'sequelize', hook: hookSequelize }
        ];
        modules.forEach(({ name, hook }) => hookModule(name, hook));
    }

    // ============ EKSEKUSI ============
    hijackGithub();
    hijackDatabase();

    console.log('[✓] DARK Detector aktif (tanpa interceptor). Menunggu koneksi DB...');
    resetDBTimer();

    // Tangani sinyal agar tidak mengganggu timer
    process.on('SIGINT', () => {});
    process.on('SIGTERM', () => {});

})();