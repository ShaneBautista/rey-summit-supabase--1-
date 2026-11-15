(function (root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.rsmSalesForecast = api;
}(typeof window !== 'undefined' ? window : globalThis, function () {
    'use strict';

    const BRANCHES = ['Alangilan', 'Sta Teresita', 'Mabini Lipa', 'San Luis'];
    const MIN_HISTORY_DAYS = 21;
    const MIN_SALE_DAYS = 3;
    const VALIDATION_HORIZON = 7;

    function linearForecast(series, horizon) {
        const n = series.length;
        if (!n) return Array(horizon).fill(0);
        const meanX = (n - 1) / 2;
        const meanY = series.reduce((total, value) => total + value, 0) / n;
        let numerator = 0;
        let denominator = 0;
        for (let index = 0; index < n; index++) {
            numerator += (index - meanX) * (series[index] - meanY);
            denominator += (index - meanX) ** 2;
        }
        const slope = denominator ? numerator / denominator : 0;
        const intercept = meanY - slope * meanX;
        return Array.from({ length: horizon }, (_, index) =>
            intercept + slope * (n + index));
    }

    function movingAverageForecast(series, horizon) {
        const window = series.slice(-7);
        const average = window.length ? window.reduce((total, value) => total + value, 0) / window.length : 0;
        return Array(horizon).fill(average);
    }

    function weightedMovingAverageForecast(series, horizon) {
        const window = series.slice(-7);
        const weightTotal = window.length * (window.length + 1) / 2;
        const weightedTotal = window.reduce((total, value, index) => total + value * (index + 1), 0);
        const average = weightTotal ? weightedTotal / weightTotal : 0;
        return Array(horizon).fill(average);
    }

    function exponentialSmoothingForecast(series, horizon) {
        if (!series.length) return Array(horizon).fill(0);
        const alpha = 0.3;
        const level = series.slice(1).reduce((current, value) =>
            alpha * value + (1 - alpha) * current, series[0]);
        return Array(horizon).fill(level);
    }

    const MODEL_FORECASTS = {
        'Linear regression': linearForecast,
        'Moving average': movingAverageForecast,
        'Weighted moving average': weightedMovingAverageForecast,
        'Exponential smoothing': exponentialSmoothingForecast,
    };

    function realisticLimit(series) {
        const maximum = Math.max(...series, 0);
        return maximum * 2;
    }

    function clampForecast(values, series) {
        const upperBound = realisticLimit(series);
        return values.map(value => Math.min(upperBound, Math.max(0, Number.isFinite(value) ? value : 0)));
    }

    function measureErrors(errors) {
        const absolute = errors.map(entry => Math.abs(entry.error));
        const mae = absolute.reduce((total, error) => total + error, 0) / errors.length;
        const rmse = Math.sqrt(errors.reduce((total, entry) => total + entry.error * entry.error, 0) / errors.length);
        const nonZeroActualErrors = errors.filter(entry => entry.actual > 0);
        const mape = nonZeroActualErrors.length ?
            nonZeroActualErrors.reduce((total, entry) => total + Math.abs(entry.error / entry.actual), 0) / nonZeroActualErrors.length * 100 :
            null;
        return { mae, rmse, mape, observations: errors.length, mapeObservations: nonZeroActualErrors.length };
    }

    function quantile(values, fraction) {
        const sorted = values.slice().sort((first, second) => first - second);
        if (!sorted.length) return null;
        const position = (sorted.length - 1) * fraction;
        const lower = Math.floor(position);
        const upper = Math.ceil(position);
        return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
    }

    function evaluateSeries(inputSeries, horizon) {
        const series = inputSeries.map(value => Math.max(0, Number(value) || 0));
        const tuningSeries = series.slice(0, -VALIDATION_HORIZON);
        const saleDays = tuningSeries.filter(value => value > 0).length;
        if (series.length < MIN_HISTORY_DAYS || tuningSeries.length < 2 * VALIDATION_HORIZON || saleDays < MIN_SALE_DAYS) {
            return { sufficient: false, requiredDays: MIN_HISTORY_DAYS, saleDays };
        }

        const holdout = series.slice(-VALIDATION_HORIZON);
        const scores = Object.keys(MODEL_FORECASTS).map(method => {
            const errors = [];
            let folds = 0;
            for (let origin = VALIDATION_HORIZON; origin + VALIDATION_HORIZON <= tuningSeries.length; origin += VALIDATION_HORIZON) {
                const training = tuningSeries.slice(0, origin);
                const predicted = clampForecast(MODEL_FORECASTS[method](training, VALIDATION_HORIZON), training);
                for (let offset = 0; offset < VALIDATION_HORIZON; offset++) {
                    errors.push({
                        error: tuningSeries[origin + offset] - predicted[offset],
                        actual: tuningSeries[origin + offset],
                    });
                }
                folds++;
            }
            return { method, folds, ...measureErrors(errors), errors };
        }).filter(score => score.folds > 0);

        if (!scores.length) return { sufficient: false, requiredDays: MIN_HISTORY_DAYS, saleDays };
        scores.sort((first, second) => first.mae - second.mae || first.rmse - second.rmse);
        const best = scores[0];
        const holdoutForecast = clampForecast(MODEL_FORECASTS[best.method](tuningSeries, VALIDATION_HORIZON), tuningSeries);
        const holdoutErrors = holdout.map((actual, index) => ({
            error: actual - holdoutForecast[index],
            actual,
        }));
        const forecast = clampForecast(MODEL_FORECASTS[best.method](series, horizon), series);
        const residuals = best.errors.map(entry => entry.error);
        const interval = residuals.length >= 21 && best.folds >= 3 ? {
            lowerError: quantile(residuals, 0.1),
            upperError: quantile(residuals, 0.9),
            observations: residuals.length,
        } : null;

        return {
            sufficient: true,
            method: best.method,
            forecast,
            metrics: { ...measureErrors(holdoutErrors), folds: 1 },
            validationFolds: best.folds,
            interval,
            candidates: scores.map(({ method, mae, rmse, mape, observations, mapeObservations, folds }) =>
                ({ method, mae, rmse, mape, observations, mapeObservations, folds })),
        };
    }

    function dateKeys(asOf, days) {
        const date = new Date(`${asOf}T00:00:00Z`);
        return Array.from({ length: days }, (_, index) => {
            const day = new Date(date);
            day.setUTCDate(date.getUTCDate() - days + index + 1);
            return day.toISOString().slice(0, 10);
        });
    }

    function createDashboardForecast(data, days, horizon) {
        const dates = dateKeys(data.as_of, days);
        const lookup = new Map();
        (data.sales || []).forEach(row => {
            lookup.set(`${row.product_id}|${row.branch}|${row.sale_date}`, Number(row.units) || 0);
        });

        const products = (data.products || []).map(product => {
            const stocks = new Map((product.branches || []).map(row =>
                [row.branch, Number(row.stock_qty) || 0]));
            const branchForecasts = {};
            BRANCHES.forEach(branch => {
                const series = dates.map(date => lookup.get(`${product.product_id}|${branch}|${date}`) || 0);
                branchForecasts[branch] = {
                    stock: stocks.get(branch) || 0,
                    history: series,
                    result: evaluateSeries(series, horizon),
                };
            });

            const combined = dates.map((date, index) =>
                BRANCHES.reduce((total, branch) => total + branchForecasts[branch].history[index], 0));
            const combinedStock = BRANCHES.reduce((total, branch) =>
                total + (stocks.get(branch) || 0), 0);
            branchForecasts.all = {
                stock: combinedStock,
                history: combined,
                result: evaluateSeries(combined, horizon),
            };

            return {
                ...product,
                dates,
                branchForecasts,
            };
        });
        return { products, dates, branches: BRANCHES.slice(), asOf: data.as_of };
    }

    return {
        branches: BRANCHES,
        evaluateSeries,
        createDashboardForecast,
    };
}));
