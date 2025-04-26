const { Builder, Browser, By, until } = require('selenium-webdriver');
const api = require('@actual-app/api');
const { closeBudget, ensurePayee, getAccountBalance, getAccountNote, openBudget, showPercent, sleep } = require('./utils');
require("dotenv").config();

async function getHomeValue(baseURL) {
    let driver = await new Builder()
        .forBrowser(Browser.CHROME)
        .build();

    try {
        // Clean handling of /vurdering
        let fullURL = baseURL.trim();
        if (!fullURL.endsWith('/vurdering')) {
            fullURL = fullURL.endsWith('/') ? fullURL + 'vurdering' : fullURL + '/vurdering';
        }

        console.log('Full Dingeo URL:', fullURL);

        await driver.get(fullURL);

        const valueElement = await driver.wait(
            until.elementLocated(By.css('.circle-tile-number.text-faded')),
            5000
        );

        const text = await valueElement.getText();
        const match = text.match(/([\d\.]+)/);
        if (match) {
            const value = parseInt(match[1].replace(/\./g, ''));
            return value; // Return clean integer (no "kr", no ".")
        }
    } catch (error) {
        console.log('Error parsing Dingeo page:');
        console.log(error);
    } finally {
        await driver.quit();
    }

    return undefined;
}

(async function() {
    await openBudget();

    const payeeId = await ensurePayee(process.env.ZESTIMATE_PAYEE_NAME || 'Home Value');

    const accounts = await api.getAccounts();
    for (const account of accounts) {
        const note = await getAccountNote(account);

        if (note && note.indexOf('dingestimat:') > -1) { // << Changed to 'dingestimat:'
            const baseURL = note.split('dingestimat:')[1].split(' ')[0];

            let ownership = 1;
            if (note.indexOf('ownership:') > -1) {
                ownership = parseFloat(note.split('ownership:')[1].split(' ')[0]);
            }

            console.log('Fetching home value for account:', account.name);
            console.log('Base URL:', baseURL);

            const homeValue = await getHomeValue(baseURL);
            if (!homeValue) {
                console.log('Was unable to get home value, skipping');
                continue;
            }
            const balance = await getAccountBalance(account);
            const diff = (homeValue * ownership) - balance;

            console.log('Home Value:', homeValue);
            console.log('Ownership Value:', homeValue * ownership);
            console.log('Balance:', balance);
            console.log('Difference:', diff);

            if (diff !== 0) {
                await api.importTransactions(account.id, [{
                    date: new Date(),
                    payee: payeeId,
                    amount: diff,
                    cleared: true,
                    reconciled: true,
                    notes: `Update Home Value to ${homeValue * ownership} (${homeValue} * ${showPercent(ownership)})`,
                }]);
            }

            await sleep(1324);
        }
    }

    await closeBudget();
})();
