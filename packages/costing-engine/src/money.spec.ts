import { add, mul, percentOf, round } from './money';

describe('money helpers', () => {
  it('avoids floating point error', () => {
    expect(add('0.1', '0.2').toString()).toBe('0.3');
  });
  it('computes the reference line totals', () => {
    expect(mul('20.94', '98').toString()).toBe('2052.12');
    expect(mul('0.8', '270').toString()).toBe('216');
  });
  it('computes percentages and rounds half up', () => {
    expect(percentOf('2052.12', '18').toString()).toBe('369.3816');
    expect(round('1.005', 2).toString()).toBe('1.01');
  });
});
