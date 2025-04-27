const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const api = require('@actual-app/api');
const { closeBudget, ensurePayee, getAccountBalance, getAccountNote, openBudget, showPercent, sleep } = require('./utils');
require("dotenv").config();

// Enable stealth mode
puppeteer.use(StealthPlugin());

// Helper: Retry wrapper
async function retry(fn, retries = 1, delayMs = 2000) {
    try {
        return await fn();
    } catch (error) {
        if (retries > 0) {
            console.log(`Retrying after error: ${error.message || error}. Waiting ${delayMs}ms...`);
            await new Promise(res => setTimeout(res, delayMs));
            return retry(fn, retries - 1, delayMs);
        } else {
            console.log('All retries failed.');
            return undefined;
        }
    }
}

// Helper: Scrape home value
async function getHomeValue(baseURL) {
    const browser = await puppeteer.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--window-size=1920,1080'
        ]
    });

    const page = await browser.newPage();

    try {
        let fullURL = baseURL.trim();
        if (!fullURL.endsWith('/vurdering')) {
            fullURL = fullURL.endsWith('/') ? fullURL + 'vurdering' : fullURL + '/vurdering';
        }

        await page.goto(fullURL, { waitUntil: 'domcontentloaded', timeout: 30000 });

        const metaContent = await page.$eval('meta[property="og:description"]', el => el.getAttribute('content'));

        const match = metaContent.match(/([\d\.]+)\s*kr/);
        if (match) {
            const value = parseInt(match[1].replace(/\./g, '')) * 100;
            return value;
        }
    } catch (error) {
        console.log('Error fetching or parsing Dingeo page:', error.message || error);
    } finally {
        await browser.close();
    }

    return undefined;
}

// Helper: Format number like 6.075.000
function formatNumberWithDots(num) {
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

// Main logic
(async function() {
    try {
        await openBudget();

        const payeeId = await ensurePayee(process.env.ZESTIMATE_PAYEE_NAME || 'Home Value');

        const accounts = await api.getAccounts();
        for (const account of accounts) {
            const note = await getAccountNote(account);

            if (note && note.indexOf('dingestimat:') > -1) {
                const baseURL = note.split('dingestimat:')[1].split(' ')[0];

                let ownership = 1;
                if (note.indexOf('ownership:') > -1) {
                    ownership = parseFloat(note.split('ownership:')[1].split(' ')[0]);
                }

                const homeValue = await retry(() => getHomeValue(baseURL));
                if (!homeValue) {
                    continue;
                }
                const balance = await getAccountBalance(account);
                const diff = (homeValue * ownership) - balance;

                if (diff !== 0) {
                    const formattedValue = formatNumberWithDots(Math.round(homeValue * ownership / 100));

                    let noteText = `Update Home Value to ${formattedValue}`;
                    if (ownership < 1) {
                        noteText += ` (${formatNumberWithDots(homeValue / 100)} * ${showPercent(ownership)})`;
                    }

                    await api.importTransactions(account.id, [{
                        date: new Date(),
                        payee: payeeId,
                        amount: diff,
                        cleared: true,
                        reconciled: true,
                        notes: noteText,
                    }]);
                }

                await sleep(1324);
            }
        }

        await closeBudget();
    } catch (error) {
        console.log('Top level error:', error.message || error);
    }
})();
