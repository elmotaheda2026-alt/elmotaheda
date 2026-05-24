/**
 * Arabic Tafqeet Helper
 * Converts numbers into classical Arabic wording for Egyptian Pounds (جنيه مصري).
 */

export function tafqeet(num: number): string {
  if (num === 0) return 'صفر';
  
  const ones = [
    '', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة',
    'عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر',
    'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'
  ];
  
  const tens = [
    '', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'
  ];
  
  const hundreds = [
    '', 'مائة', 'مائتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة'
  ];
  
  const processGroup = (n: number): string => {
    let result = '';
    const h = Math.floor(n / 100);
    const remainder = n % 100;
    
    if (h > 0) {
      result += hundreds[h];
    }
    
    if (remainder > 0) {
      if (result !== '') result += ' و';
      
      if (remainder < 20) {
        result += ones[remainder];
      } else {
        const t = Math.floor(remainder / 10);
        const o = remainder % 10;
        
        if (o > 0) {
          result += ones[o] + ' و' + tens[t];
        } else {
          result += tens[t];
        }
      }
    }
    
    return result;
  };
  
  const integerPart = Math.floor(num);
  const decimalPart = Math.round((num - integerPart) * 100);
  
  let words = '';
  
  if (integerPart > 0) {
    const millions = Math.floor(integerPart / 1000000);
    const thousands = Math.floor((integerPart % 1000000) / 1000);
    const rest = integerPart % 1000;
    
    if (millions > 0) {
      if (millions === 1) {
        words += 'مليون';
      } else if (millions === 2) {
        words += 'مليونان';
      } else if (millions >= 3 && millions <= 10) {
        words += processGroup(millions) + ' ملايين';
      } else {
        words += processGroup(millions) + ' مليون';
      }
      
      if (thousands > 0 || rest > 0) words += ' و';
    }
    
    if (thousands > 0) {
      if (thousands === 1) {
        words += 'ألف';
      } else if (thousands === 2) {
        words += 'ألفان';
      } else if (thousands >= 3 && thousands <= 10) {
        words += processGroup(thousands) + ' آلاف';
      } else {
        words += processGroup(thousands) + ' ألف';
      }
      
      if (rest > 0) {
        words += ' و' + processGroup(rest);
      }
    } else if (rest > 0 || words === '') {
      words += processGroup(rest);
    }
  }
  
  let finalResult = words + ' جنية'; // Egyptian spelling often uses جنية or جنيه
  
  if (decimalPart > 0) {
    finalResult += ' و' + processGroup(decimalPart) + ' قرشاً';
  }
  
  return finalResult + ' لا غير';
}
