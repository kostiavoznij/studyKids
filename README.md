# Уроки

Застосунок для репетиторки: календар уроків, учні, гроші, перенесення/скасування, статистика.
Працює як PWA — встановлюється на iPhone і ПК як звичайний застосунок.

План і рішення — у [docs/PLAN.md](docs/PLAN.md).

## Запуск локально

```bash
cd app
npm install
npm run dev        # http://localhost:5173
```

`npm run build` — перевірка типів і збірка в `app/dist`.
`npm run icons` — перегенерувати PNG-іконки з `app/public/favicon.svg` та `app/icons/icon-full.svg`.

## Публікація

Кожен push у `main` збирає застосунок і викладає його на GitHub Pages
(`.github/workflows/deploy.yml`). Один раз треба увімкнути: Settings → Pages → Source: **GitHub Actions**.

## Структура

```
backend/     Code.gs — сервер синхронізації в Google Apps Script; dev/ — локальна заглушка
app/src/
  data/      модель, сховище (zustand + localStorage), розклад, оплати, статистика, синхронізація, демо-дані
  screens/   календар, картка уроку, учні, сторінка учня, статистика, налаштування
  ui/        спільні компоненти, графіки, поля форм, роутер
  styles/    теми оформлення і стилі
```

Синхронізація між пристроями — через Google Таблицю (`backend/Code.gs`),
як підключити — [docs/SYNC_SETUP.md](docs/SYNC_SETUP.md).
