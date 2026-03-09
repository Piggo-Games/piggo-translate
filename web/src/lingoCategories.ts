export type LingoCategoryEntry = {
  id: string
  character: string
  primaryMeaning: string
  primaryPinyin: string
}

export type LingoCategory = {
  title: string
  description: string
  entries: LingoCategoryEntry[]
}

export const lingoCategories: LingoCategory[] = [
  {
    title: "Greetings",
    description: "Simple openers and day-to-day politeness",
    entries: [
      {
        id: "greetings-hello",
        character: "喂",
        primaryMeaning: "hello",
        primaryPinyin: "wèi"
      },
      {
        id: "greetings-thanks",
        character: "谢",
        primaryMeaning: "thanks",
        primaryPinyin: "xiè"
      },
      {
        id: "greetings-good",
        character: "好",
        primaryMeaning: "good",
        primaryPinyin: "hǎo"
      },
      {
        id: "greetings-bye",
        character: "再",
        primaryMeaning: "again",
        primaryPinyin: "zài"
      }
    ]
  },
  {
    title: "People",
    description: "Family, friends, and everyday relationships",
    entries: [
      {
        id: "people-person",
        character: "人",
        primaryMeaning: "person",
        primaryPinyin: "rén"
      },
      {
        id: "people-friend",
        character: "朋",
        primaryMeaning: "friend",
        primaryPinyin: "péng"
      },
      {
        id: "people-home",
        character: "家",
        primaryMeaning: "home",
        primaryPinyin: "jiā"
      },
      {
        id: "people-mother",
        character: "妈",
        primaryMeaning: "mom",
        primaryPinyin: "mā"
      }
    ]
  },
  {
    title: "Time",
    description: "Useful anchors for planning the day",
    entries: [
      {
        id: "time-today",
        character: "今",
        primaryMeaning: "today",
        primaryPinyin: "jīn"
      },
      {
        id: "time-time",
        character: "时",
        primaryMeaning: "time",
        primaryPinyin: "shí"
      },
      {
        id: "time-afternoon",
        character: "午",
        primaryMeaning: "afternoon",
        primaryPinyin: "wǔ"
      },
      {
        id: "time-point",
        character: "点",
        primaryMeaning: "o'clock",
        primaryPinyin: "diǎn"
      }
    ]
  },
  {
    title: "Food",
    description: "Core dining and ordering vocabulary",
    entries: [
      {
        id: "food-eat",
        character: "吃",
        primaryMeaning: "eat",
        primaryPinyin: "chī"
      },
      {
        id: "food-drink",
        character: "喝",
        primaryMeaning: "drink",
        primaryPinyin: "hē"
      },
      {
        id: "food-water",
        character: "水",
        primaryMeaning: "water",
        primaryPinyin: "shuǐ"
      },
      {
        id: "food-rice",
        character: "米",
        primaryMeaning: "rice",
        primaryPinyin: "mǐ"
      }
    ]
  },
  {
    title: "Places",
    description: "Navigate home, school, and the city",
    entries: [
      {
        id: "places-home",
        character: "家",
        primaryMeaning: "home",
        primaryPinyin: "jiā"
      },
      {
        id: "places-school",
        character: "校",
        primaryMeaning: "school",
        primaryPinyin: "xiào"
      },
      {
        id: "places-room",
        character: "间",
        primaryMeaning: "room",
        primaryPinyin: "jiān"
      },
      {
        id: "places-store",
        character: "店",
        primaryMeaning: "shop",
        primaryPinyin: "diàn"
      }
    ]
  },
  {
    title: "Money",
    description: "Numbers, prices, and paying for things",
    entries: [
      {
        id: "money-cash",
        character: "钱",
        primaryMeaning: "money",
        primaryPinyin: "qián"
      },
      {
        id: "money-one",
        character: "一",
        primaryMeaning: "one",
        primaryPinyin: "yī"
      },
      {
        id: "money-two",
        character: "二",
        primaryMeaning: "two",
        primaryPinyin: "èr"
      },
      {
        id: "money-ten",
        character: "十",
        primaryMeaning: "ten",
        primaryPinyin: "shí"
      }
    ]
  }
]
