# Акаунти (Supabase)

Записи зберігаються в базі Supabase, вхід — через Google. Доступ мають лише пошти зі списку
`members` на сервері; будь-хто інший після входу бачить «немає доступу» і не отримує жодного запису.

| Проєкт | Ref | Для чого |
|---|---|---|
| `uroky` | `cecjmzwrrcerltreifsu` | опублікований застосунок (`app/.env.production`) |
| `uroky-test` | `vydjijtbqaqapmotenop` | розробка на `localhost:5199` (`app/.env.development`) |

Ключі `sb_publishable_…` у `.env.*` публічні за задумом. Секретний `service_role` ключ нікуди в код не кладемо.

## Як це влаштовано

- Кожен запис застосунку (учень, урок, оплата, податок…) — рядок у таблиці `records`: тип, id і весь запис у JSON.
- Пристрій відправляє змінені записи через `push_records()` — сервер лишає новішу зміну кожного запису —
  і забирає все, що новіше за останню бачену ревізію. Без інтернету застосунок працює як раніше й досилає зміни пізніше.
- Читати й писати записи може лише роль `admin`; це перевіряє сама база (row level security), не інтерфейс.
- Вчителькам (роль `teacher`) прямого доступу до `records` не буде: лише окремі функції з їхніми уроками без грошей.

Схема — у `supabase/migrations`.

## Додати людину

1. У Google Cloud Console → Google Auth Platform → **Audience → Test users** додати її Gmail
   (поки застосунок у режимі Testing, Google пускає лише ці пошти).
2. Внести в `members`:

```bash
npx supabase db query --remote=cecjmzwrrcerltreifsu --yes \
  "insert into public.members (email, role, name) values ('пошта@gmail.com', 'admin', 'Ім''я')"
```

Прибрати доступ — `delete from public.members where email = '…'`.

## Змінити базу

Новий SQL-файл у `supabase/migrations`, потім спершу тест, після перевірки — робочий:

```bash
npx supabase db push --remote=vydjijtbqaqapmotenop --yes
npx supabase db push --remote=cecjmzwrrcerltreifsu --yes
```

## Перенести пристрій в акаунт

Ще → Акаунт → «Увійти через Google». Пристрій з демо-даними або порожній просто отримує записи акаунта.
Якщо на пристрої є свої записи, застосунок питає: «Перенести в акаунт» (додати їх, новіша зміна перемагає)
чи «Не переносити» (прибрати їх і взяти лише записи акаунта). Google Таблиця після переходу відключається
й лишається архівом.
