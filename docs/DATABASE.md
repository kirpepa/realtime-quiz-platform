# Модель базы данных

СУБД: **SQLite** (файл `server/prisma/dev.db`), ORM — **Prisma**. Схема —
в `server/prisma/schema.prisma`.

## ER-диаграмма

```
User ──1:N──► Quiz ──1:N──► Question ──1:N──► AnswerOption
                │                 ▲
                │                 │
                └──1:N──► QuizSession ──1:N──► SessionParticipant ──► User? (гость = null)
                                    │                    │
                                    └──1:N──► ParticipantAnswer ◄──┘
                                                  │
                                                  └──► Question
```

## Таблицы

### User — организаторы и зарегистрированные участники

| Поле          | Тип      | Описание                              |
|---------------|----------|---------------------------------------|
| id            | cuid PK  |                                       |
| email         | string   | уникальный                            |
| passwordHash  | string   | bcrypt-хэш                            |
| role          | string   | `organizer` \| `participant`          |
| nickname      | string   | отображаемое имя                      |
| createdAt     | datetime |                                       |

### Quiz — квиз и его правила

| Поле                    | Тип     | Описание                             |
|-------------------------|---------|--------------------------------------|
| id                      | cuid PK |                                      |
| ownerId                 | FK User | владелец (организатор)               |
| title, description      | string  |                                      |
| category                | string  | категория                            |
| defaultTimePerQuestion  | int     | время на вопрос по умолчанию, сек    |
| allowAnswerChange       | bool    | разрешить менять ответ               |
| speedBonus              | bool    | учитывать скорость при подсчёте      |

### Question — вопрос квиза

| Поле        | Тип       | Описание                                    |
|-------------|-----------|---------------------------------------------|
| id          | cuid PK   |                                             |
| quizId      | FK Quiz   |                                             |
| type        | string    | `text` \| `image`                           |
| answerType  | string    | `single` \| `multiple`                      |
| text        | string    | формулировка                                |
| imageUrl    | string?   | путь к загруженному изображению             |
| timeLimit   | int?      | переопределение времени (null = по умолч.)  |
| orderIndex  | int       | порядок в квизе                             |

### AnswerOption — вариант ответа

| Поле        | Тип         | Описание               |
|-------------|-------------|------------------------|
| id          | cuid PK     |                        |
| questionId  | FK Question |                        |
| text        | string      |                        |
| isCorrect   | bool        | правильный ли вариант  |
| orderIndex  | int         | порядок                |

### QuizSession — один запуск квиза (комната)

| Поле        | Тип       | Описание                            |
|-------------|-----------|-------------------------------------|
| id          | cuid PK   |                                     |
| quizId      | FK Quiz   |                                     |
| roomCode    | string    | уникальный 6-символьный код         |
| status      | string    | `pending` \| `active` \| `finished` |
| startedAt   | datetime? |                                     |
| finishedAt  | datetime? |                                     |

### SessionParticipant — участник конкретной сессии (в т.ч. гость)

| Поле        | Тип            | Описание                        |
|-------------|----------------|---------------------------------|
| id          | cuid PK        |                                 |
| sessionId   | FK QuizSession |                                 |
| userId      | FK User?       | null для гостя                  |
| nickname    | string         |                                 |
| score       | int            | итоговые баллы в сессии         |

Уникальный индекс `(sessionId, userId)` не позволяет создать две записи одного
авторизованного пользователя в сессии. SQLite допускает несколько `NULL`,
поэтому гостевые участники этим индексом не ограничены.

### ParticipantAnswer — ответ участника на вопрос (для аудита и пересчёта)

| Поле              | Тип         | Описание                                     |
|-------------------|-------------|----------------------------------------------|
| id                | cuid PK     |                                              |
| sessionId         | FK          |                                              |
| questionId        | FK          |                                              |
| participantId     | FK          |                                              |
| selectedOptionIds | string      | JSON-массив id вариантов (в SQLite нет array) |
| isCorrect         | bool        |                                              |
| scoreAwarded      | int         | начислено баллов за этот ответ               |
| answeredAt        | datetime    |                                              |

Уникальный индекс `(sessionId, questionId, participantId)` — один ответ на вопрос
на участника.

Каскадное удаление (`onDelete: Cascade`) настроено по цепочкам Quiz → Question →
AnswerOption и Session → Participant → Answer.
