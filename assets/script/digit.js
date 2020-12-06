export default class Digit {
  constructor(number) {
    this.number = Number(number);
    this.units = [
      // 0 - 999
      { symbol: '',limit: 1e3},
      // 1 000 - 999 999
      { symbol: 'K',limit: 1e6},
      // 1 000 000 - 999 999 999
      { symbol: 'M',limit: 1e9},
      // 1 000 000 000 - 999 999 999 999
      { symbol: 'B',limit: 1e12},
      // 1 000 000 000 000 - 999 999 999 999 999
      { symbol: 'T', limit: 1e15 },
      { symbol: 'E', limit: 1e18 }
    ];
  }

  shorten(){
    var unit = this.units.find(e => (this.number < e.limit));
    var num = (1000 * this.number / unit.limit);
    num = Math.round(num * 10) / 10; // keep one decimal number, only if needed
    return (num + unit.symbol);
  }

  // abbreviate() {}
  // annotate() {}
};
