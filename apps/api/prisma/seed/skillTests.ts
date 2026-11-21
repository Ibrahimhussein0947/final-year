// Starter skill tests. WRITTEN BY THE DEVELOPER, NOT BY A SUBJECT EXPERT: have someone who does this work check the questions
// before relying on a "Tested" mark, and add more tests from the administrator screens. Created only if the skill has no test yet,
// so an administrator's edits are never overwritten. `answer` is the index of the right option.

export interface SeedQuestion { id: string; text: string; options: string[]; answer: number }
export interface SeedTest { skillSlug: string; title: string; description: string; passPercent: number; questionsAsked: number; questions: SeedQuestion[] }

export const skillTests: SeedTest[] = [
  {
    skillSlug: 'ms-office',
    title: 'Microsoft Office basics',
    description: 'Everyday Word and Excel: saving, copying, formulas, cells.',
    passPercent: 70,
    questionsAsked: 8,
    questions: [
      { id: 'q1', text: 'Which keys save a file in Word and Excel?', options: ['Ctrl + S', 'Ctrl + P', 'Ctrl + C', 'Ctrl + Z'], answer: 0 },
      { id: 'q2', text: 'In Excel, a formula starts with which sign?', options: ['#', '=', '@', '&'], answer: 1 },
      { id: 'q3', text: 'What does =SUM(B2:B6) do in Excel?', options: ['Counts the cells from B2 to B6', 'Adds the numbers in cells B2 to B6', 'Finds the biggest number in B2 to B6', 'Multiplies B2 by B6'], answer: 1 },
      { id: 'q4', text: 'Cell A1 holds 10 and cell A2 holds 20. What does =A1*A2 show?', options: ['30', '1020', '200', '10'], answer: 2 },
      { id: 'q5', text: 'Which keys copy the selected text or cells?', options: ['Ctrl + V', 'Ctrl + X', 'Ctrl + C', 'Ctrl + A'], answer: 2 },
      { id: 'q6', text: 'Which keys undo your last action?', options: ['Ctrl + Y', 'Ctrl + Z', 'Ctrl + U', 'Ctrl + N'], answer: 1 },
      { id: 'q7', text: 'In Excel, what is the cell in column C and row 5 called?', options: ['5C', 'C-5 row', 'C5', 'Cell 5'], answer: 2 },
      { id: 'q8', text: 'Which Excel function gives the average of a group of numbers?', options: ['AVERAGE', 'TOTAL', 'MEAN VALUE', 'MIDDLE'], answer: 0 },
      { id: 'q9', text: 'A1 holds 5 and A2 holds 7. What does =A1+A2 show?', options: ['57', '12', '35', '2'], answer: 1 },
      { id: 'q10', text: 'Which file ending does a modern Word document normally have?', options: ['.xlsx', '.pptx', '.docx', '.jpg'], answer: 2 },
      { id: 'q11', text: 'What does =COUNT(A1:A5) count?', options: ['All the cells, empty or not', 'The cells that contain numbers', 'The letters in the cells', 'The rows on the page'], answer: 1 },
      { id: 'q12', text: 'You copied some text. Which keys put it somewhere else?', options: ['Ctrl + V', 'Ctrl + S', 'Ctrl + B', 'Ctrl + P'], answer: 0 },
    ],
  },
  {
    skillSlug: 'cashiering',
    title: 'Cashier basics',
    description: 'Giving change, adding up bills, and handling cash honestly.',
    passPercent: 75,
    questionsAsked: 8,
    questions: [
      { id: 'q1', text: 'An item costs 45 birr. The customer gives you 100 birr. How much change do you give?', options: ['45 birr', '55 birr', '65 birr', '60 birr'], answer: 1 },
      { id: 'q2', text: 'A customer buys 3 items at 27 birr each. What is the total?', options: ['81 birr', '72 birr', '84 birr', '63 birr'], answer: 0 },
      { id: 'q3', text: 'The bill is 137 birr and the customer gives 200 birr. What is the change?', options: ['53 birr', '73 birr', '63 birr', '67 birr'], answer: 2 },
      { id: 'q4', text: 'Why should you keep the customer\'s money where it can be seen until you have given the change?', options: ['So the shop looks busy', 'To avoid a dispute about how much they gave you', 'So you can count it twice for fun', 'It makes no difference'], answer: 1 },
      { id: 'q5', text: 'A 15% discount is given on a 200 birr item. What does the customer pay?', options: ['185 birr', '170 birr', '30 birr', '175 birr'], answer: 1 },
      { id: 'q6', text: 'Assume VAT is 15%. An item costs 100 birr before VAT. What is the price with VAT?', options: ['115 birr', '150 birr', '105 birr', '85 birr'], answer: 0 },
      { id: 'q7', text: 'A customer buys 2 kg of onions at 60 birr per kg. What is the total?', options: ['62 birr', '120 birr', '30 birr', '180 birr'], answer: 1 },
      { id: 'q8', text: 'The total is 1,250 birr and the customer pays 1,500 birr. What is the change?', options: ['150 birr', '350 birr', '250 birr', '200 birr'], answer: 2 },
      { id: 'q9', text: 'At the end of your shift the cash is 500 birr less than the records show. What do you do first?', options: ['Take it from the next customer', 'Say nothing and hope it is forgotten', 'Recount, then tell your supervisor honestly', 'Add your own money quietly'], answer: 2 },
      { id: 'q10', text: 'A banknote looks suspicious. What is best?', options: ['Accept it to avoid an argument', 'Politely follow your shop\'s rule for checking it, for example call your supervisor', 'Shout at the customer', 'Give it back and give them the goods anyway'], answer: 1 },
      { id: 'q11', text: 'The bill is 148 birr. The customer gives you 100 birr and 50 birr. What is the change?', options: ['2 birr', '12 birr', '1 birr', '52 birr'], answer: 0 },
      { id: 'q12', text: 'Why do you count the cash in your till at the start of your shift?', options: ['It is not needed', 'So any difference at the end can be understood and not blamed on the wrong person', 'To make the shift shorter', 'Only to impress the manager'], answer: 1 },
    ],
  },
  {
    skillSlug: 'food-safety-haccp',
    title: 'Food safety basics',
    description: 'Clean hands, safe temperatures and keeping raw and cooked food apart.',
    passPercent: 75,
    questionsAsked: 8,
    questions: [
      { id: 'q1', text: 'When must you wash your hands with soap and water?', options: ['Only when they look dirty', 'Before handling food, after the toilet, and after touching raw meat', 'Only at the end of the day', 'Only after touching money'], answer: 1 },
      { id: 'q2', text: 'How should raw meat and ready-to-eat food be kept?', options: ['Together, to save space', 'Separate, so germs from the raw meat do not reach the other food', 'Raw meat above cooked food', 'It makes no difference'], answer: 1 },
      { id: 'q3', text: 'Cold food that can spoil should be kept at about:', options: ['5 °C or colder', '15 °C', '25 °C', '30 °C'], answer: 0 },
      { id: 'q4', text: 'Hot food that is waiting to be served should be kept at about:', options: ['30 °C', '40 °C', '60 °C or hotter', '45 °C'], answer: 2 },
      { id: 'q5', text: 'Germs multiply fastest in food that stays:', options: ['Frozen solid', 'Between about 5 °C and 60 °C', 'Above 90 °C', 'In a closed tin'], answer: 1 },
      { id: 'q6', text: 'How do you know chicken is cooked safely?', options: ['The outside is brown', 'It is hot all the way through, with no pink meat and clear juices', 'It has been in the pan for 2 minutes', 'It smells good'], answer: 1 },
      { id: 'q7', text: 'What should you do with leftover cooked food?', options: ['Leave it on the table all day', 'Cool it quickly and put it in the fridge within about 2 hours', 'Leave it in a warm kitchen overnight', 'Cover it and leave it in the sun'], answer: 1 },
      { id: 'q8', text: 'You used a board for raw meat. Before cutting vegetables on it you must:', options: ['Wipe it with a dry cloth', 'Wash it well with hot water and soap', 'Turn it over', 'Nothing'], answer: 1 },
      { id: 'q9', text: 'You have diarrhoea or are vomiting. What should you do?', options: ['Work as normal', 'Not handle food, and tell your supervisor', 'Handle food but wear gloves', 'Only work in the dining room'], answer: 1 },
      { id: 'q10', text: 'What is the safest way to thaw frozen meat?', options: ['On the counter for many hours', 'In the fridge', 'In the sun', 'Near the cooker, for a day'], answer: 1 },
      { id: 'q11', text: 'The "use by" date on a food has passed. What do you do?', options: ['Use it if it smells fine', 'Throw it away', 'Cook it for longer', 'Sell it cheaper'], answer: 1 },
      { id: 'q12', text: 'You have a cut on your hand. What do you do before handling food?', options: ['Nothing, it is small', 'Cover it with a clean waterproof plaster and a glove', 'Wash it once', 'Hold it behind your back'], answer: 1 },
    ],
  },
];
