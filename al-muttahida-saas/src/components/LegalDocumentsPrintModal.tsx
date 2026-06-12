import React, { useState, useEffect } from 'react';
import { X, Printer, Settings, CheckSquare, Eye, Edit3, Users, FileText, Calendar } from 'lucide-react';
import { Sale, Customer } from '../types';
import { getCustomers } from '../lib/storage';
import { tafqeet } from '../lib/tafqeet';
import { formatDateDisplay } from '../lib/dateUtils';

interface LegalDocumentsPrintModalProps {
  isOpen: boolean;
  onClose: () => void;
  sale: Sale | null;
  onSuccess?: () => void;
}

// Egyptian National ID date of birth extractor helper
export function extractBirthDateFromNationalId(nationalId: string): string {
  if (!nationalId || nationalId.length !== 14) return '---';
  const centuryCode = nationalId.charAt(0);
  const year = nationalId.substring(1, 3);
  const month = nationalId.substring(3, 5);
  const day = nationalId.substring(5, 7);
  
  let century = '19';
  if (centuryCode === '3') century = '20';
  else if (centuryCode === '2') century = '19';
  
  return `${century}${year}-${month}-${day}`;
}

export default function LegalDocumentsPrintModal({
  isOpen,
  onClose,
  sale,
  onSuccess
}: LegalDocumentsPrintModalProps) {
  const [customer, setCustomer] = useState<Customer | null>(null);
  
  // Custom print parameters
  const [firstPartyName, setFirstPartyName] = useState('مصطفى صبحي مصطفى بسيوني');
  const [thirdPartyName, setThirdPartyName] = useState('احمد نشأت احمد محمد');
  const [lawyerName, setLawyerName] = useState('عبدالفتاح عبدالفتاح السبع');
  const [itemType, setItemType] = useState('');
  const [amount, setAmount] = useState(0);
  const [amountInWords, setAmountInWords] = useState('');
  
  // Target signatory (customer or guarantors) for individual documents
  const [selectedSignatory, setSelectedSignatory] = useState<'customer' | 'guarantor1' | 'guarantor2' | 'guarantor3'>('customer');

  // Tab/Document Selection
  const [selectedDocs, setSelectedDocs] = useState({
    creditApplication: true, // طلب شراء بالآجل
    installmentStatement: true, // NEW: كشف حساب الأقساط
    customerFile: true,
    saleStatement: true,
    trustReceipt: true,
    receiptAck: true,
    lawyerAck: true,
  });

  // Active Preview Tab
  const [activePreviewTab, setActivePreviewTab] = useState<'creditApplication' | 'installmentStatement' | 'customerFile' | 'trustReceipt' | 'receiptAck' | 'lawyerAck'>('creditApplication');

  // Load defaults and customer details
  useEffect(() => {
    if (isOpen && sale) {
      // Find customer
      const allCustomers = getCustomers();
      const matchedCustomer = allCustomers.find((c) => c.id === sale.customerId) || null;
      setCustomer(matchedCustomer);
      setSelectedSignatory('customer'); // Reset to customer default

      // Load saved configurations from localStorage if available
      const savedFirstParty = localStorage.getItem('print_firstPartyName');
      const savedThirdParty = localStorage.getItem('print_thirdPartyName');
      const savedLawyer = localStorage.getItem('print_lawyerName');
      
      if (savedFirstParty) setFirstPartyName(savedFirstParty);
      if (savedThirdParty) setThirdPartyName(savedThirdParty);
      if (savedLawyer) setLawyerName(savedLawyer);

      // Default item type to first item name
      if (sale.items && sale.items.length > 0) {
        setItemType(sale.items[0].productName);
      } else {
        setItemType('توكتوك');
      }

      // Default amount to remaining amount (since it's installment)
      const defaultAmount = sale.remaining > 0 ? sale.remaining : sale.total;
      setAmount(defaultAmount);
      setAmountInWords(tafqeet(defaultAmount));
    }
  }, [isOpen, sale]);

  // Recalculate Tafqeet when amount changes
  const handleAmountChange = (val: number) => {
    setAmount(val);
    setAmountInWords(tafqeet(val));
  };

  if (!isOpen || !sale) return null;

  // Active guarantors list helper
  const activeGuarantors = [
    { key: 'guarantor1', name: customer?.guarantors?.[0]?.name, label: 'الضامن الأول' },
    { key: 'guarantor2', name: customer?.guarantors?.[1]?.name, label: 'الضامن الثاني' },
    { key: 'guarantor3', name: customer?.guarantors?.[2]?.name, label: 'الضامن الثالث' },
  ].filter(g => !!g.name);

  // Computes active signatory data based on selected signee
  let signatoryName = sale.customerName;
  let signatoryAddress = customer?.address || '---';
  let signatoryNationalId = customer?.nationalId || '---';
  let signatoryPhone = customer?.phone || '---';
  let fileTitle = 'ملف العميل';

  if (selectedSignatory === 'guarantor1' && customer?.guarantors?.[0]) {
    const g = customer.guarantors[0];
    signatoryName = g.name;
    signatoryAddress = g.address;
    signatoryNationalId = g.nationalId;
    signatoryPhone = g.phone;
    fileTitle = 'ملف الضامن الاول';
  } else if (selectedSignatory === 'guarantor2' && customer?.guarantors?.[1]) {
    const g = customer.guarantors[1];
    signatoryName = g.name;
    signatoryAddress = g.address;
    signatoryNationalId = g.nationalId;
    signatoryPhone = g.phone;
    fileTitle = 'ملف الضامن الثاني';
  } else if (selectedSignatory === 'guarantor3' && customer?.guarantors?.[2]) {
    const g = customer.guarantors[2];
    signatoryName = g.name;
    signatoryAddress = g.address;
    signatoryNationalId = g.nationalId;
    signatoryPhone = g.phone;
    fileTitle = 'ملف الضامن الثالث';
  }

  const handleSaveDefaults = () => {
    localStorage.setItem('print_firstPartyName', firstPartyName);
    localStorage.setItem('print_thirdPartyName', thirdPartyName);
    localStorage.setItem('print_lawyerName', lawyerName);
    alert('تم حفظ الأسماء الافتراضية بنجاح!');
  };

  // Generates single signatory HTML for printing
  const generateSignatoryHtml = (partyKey: 'customer' | 'guarantor1' | 'guarantor2' | 'guarantor3', todayDate: string, formattedInvoiceDate: string) => {
    let name = sale.customerName;
    let address = customer?.address || '---';
    let nationalId = customer?.nationalId || '---';
    let phone = customer?.phone || '---';
    let title = 'ملف العميل';

    if (partyKey === 'guarantor1' && customer?.guarantors?.[0]) {
      const g = customer.guarantors[0];
      name = g.name;
      address = g.address;
      nationalId = g.nationalId;
      phone = g.phone;
      title = 'ملف الضامن الاول';
    } else if (partyKey === 'guarantor2' && customer?.guarantors?.[1]) {
      const g = customer.guarantors[1];
      name = g.name;
      address = g.address;
      nationalId = g.nationalId;
      phone = g.phone;
      title = 'ملف الضامن الثاني';
    } else if (partyKey === 'guarantor3' && customer?.guarantors?.[2]) {
      const g = customer.guarantors[2];
      name = g.name;
      address = g.address;
      nationalId = g.nationalId;
      phone = g.phone;
      title = 'ملف الضامن الثالث';
    }

    let html = '';

    // 1. Page 1: File & Sale Statement (Combined on exactly ONE single A4 page)
    if (selectedDocs.customerFile || selectedDocs.saleStatement) {
      html += `
        <div class="a4-container page-break">
          <!-- ملف العميل/الضامن الموحد -->
          <div class="title-box" style="margin-bottom: 12px;">
            <span class="title-text" style="font-size: 20px; padding: 4px 25px;">${title} وبيان بيع السلعة</span>
          </div>
          
          <div class="legal-box" style="padding: 15px 20px; flex-grow: 1; display: flex; flex-direction: column; justify-content: space-between;">
            <div>
              <table style="width: 100%; border-collapse: collapse; margin-bottom: 15px; font-size: 13.5px; font-weight: bold; border: 1.5px solid #000;">
                <tr>
                  <td style="border: 1.5px solid #000; padding: 5px 8px; background-color: #f8fafc; width: 18%; text-align: right;">الاسم:</td>
                  <td style="border: 1.5px solid #000; padding: 5px 8px; width: 32%; text-align: right;">${name}</td>
                  <td style="border: 1.5px solid #000; padding: 5px 8px; background-color: #f8fafc; width: 18%; text-align: right;">${partyKey === 'customer' ? 'رقم العميل:' : 'رقم الضامن:'}</td>
                  <td style="border: 1.5px solid #000; padding: 5px 8px; width: 32%; font-family: monospace; font-size: 15px; text-align: center;">${partyKey === 'customer' ? (customer?.customerNumber || '---') : 'ضامن'}</td>
                </tr>
                <tr>
                  <td style="border: 1.5px solid #000; padding: 5px 8px; background-color: #f8fafc; text-align: right;">العنوان:</td>
                  <td style="border: 1.5px solid #000; padding: 5px 8px; text-align: right;" colspan="3">${address}</td>
                </tr>
                <tr>
                  <td style="border: 1.5px solid #000; padding: 5px 8px; background-color: #f8fafc; text-align: right;">الرقم القومى:</td>
                  <td style="border: 1.5px solid #000; padding: 5px 8px; font-family: monospace; font-size: 14px; text-align: center;">${nationalId}</td>
                  <td style="border: 1.5px solid #000; padding: 5px 8px; background-color: #f8fafc; text-align: right;">رقم الموبايل:</td>
                  <td style="border: 1.5px solid #000; padding: 5px 8px; font-family: monospace; text-align: center;">${phone}</td>
                </tr>
                <tr>
                  <td style="border: 1.5px solid #000; padding: 5px 8px; background-color: #f8fafc; text-align: right;">نوع السلعة:</td>
                  <td style="border: 1.5px solid #000; padding: 5px 8px; text-align: right;">${itemType}</td>
                  <td style="border: 1.5px solid #000; padding: 5px 8px; background-color: #f8fafc; text-align: right;">سعر السلعة:</td>
                  <td style="border: 1.5px solid #000; padding: 5px 8px; text-align: center;">${sale.total.toLocaleString('ar-EG')} ج.م</td>
                </tr>
                <tr>
                  <td style="border: 1.5px solid #000; padding: 5px 8px; background-color: #f8fafc; text-align: right;">المبلغ المدفوع:</td>
                  <td style="border: 1.5px solid #000; padding: 5px 8px; color: #047857; text-align: center;">${sale.paid.toLocaleString('ar-EG')} ج.م</td>
                  <td style="border: 1.5px solid #000; padding: 5px 8px; background-color: #f8fafc; text-align: right;">المبلغ المتبقى:</td>
                  <td style="border: 1.5px solid #000; padding: 5px 8px; color: #b91c1c; text-align: center;">${sale.remaining.toLocaleString('ar-EG')} ج.م</td>
                </tr>
                <tr>
                  <td style="border: 1.5px solid #000; padding: 5px 8px; background-color: #f8fafc; text-align: right;">أشهر التقسيط:</td>
                  <td style="border: 1.5px solid #000; padding: 5px 8px; text-align: center;">${sale.financing?.installmentMonths || '---'} شهر</td>
                  <td style="border: 1.5px solid #000; padding: 5px 8px; background-color: #f8fafc; text-align: right;">تاريخ التعاقد:</td>
                  <td style="border: 1.5px solid #000; padding: 5px 8px; font-family: monospace; text-align: center;">${formattedInvoiceDate}</td>
                </tr>
              </table>
              
              <!-- إقرار استلام السلعة -->
              <div style="text-align: center; margin-top: 8px; margin-bottom: 5px;">
                <span class="double-underline" style="font-size: 18px; border-bottom: 2.5px double #000;">إقـــــــرار اسـتـلام</span>
              </div>
  
              <p style="text-align: justify; line-height: 1.8; font-size: 13.5px; font-weight: 700; margin: 5px 0 10px; text-indent: 30px;">
                أقر أنا الموقع أدناه / <span style="border-bottom: 1.5px solid #000; padding: 0 4px;">${name}</span> 
                المقيم / <span style="border-bottom: 1.5px solid #000; padding: 0 4px;">${address}</span> 
                وأحمل بطاقة رقم قومي / <span style="border-bottom: 1.5px solid #000; padding: 0 4px; font-family: monospace;">${nationalId}</span> 
                بأنني قد استلمت السلعة المذكورة أعلاه جديدة وغير مستعملة وبحالة ممتازة بعد المعاينة التامة النافية للجهالة وقبلتها بحالتها وقت شراؤها، وأقر وأتعهد بالتزامي الكامل بسداد جميع الأقساط في مواعيد استحقاقها المحددة، وإذا تأخرت أو امتنعت عن السداد أعتبر مبدداً وخائناً للأمانة بقيمة السلعة المشتراة وهذا إقرار مني بذلك.
              </p>
            </div>
  
            <div class="signatures-row" style="padding: 10px 10px 0; margin-top: auto; display: flex; justify-content: space-between; font-weight: 800; font-size: 16px;">
              <span>توقيع المقر: ...........................................</span>
              <span>بصمة المقر:</span>
            </div>
          </div>
        </div>
      `;
    }

    // 2. Page 2: Trust Receipt
    if (selectedDocs.trustReceipt) {
      html += `
        <div class="a4-container page-break">
          <div class="title-box">
            <span class="title-text">ايصال استلام نقدية على سبيل الامانه</span>
          </div>
          
          <div class="legal-box" style="padding: 35px 30px;">
            <p class="legal-paragraph">
              استلمت انا السيد / <span>${name}</span><br/>
              المقيم / <span>${address}</span><br/>
              واحمل رقم قومى / <span>${nationalId}</span><br/>
              من السيد / <span>${firstPartyName}</span><br/>
              مبلغ وقدره ( <span style="font-family: Arial, sans-serif; font-size: 19px; border-bottom: none; font-weight: 800;">${amount.toLocaleString('en-US')}</span> ) فقط <span>${amountInWords}</span><br/>
              وذلك بصفة امانة لتسليمها الى السيد / <span>${thirdPartyName}</span><br/>
              وذلك لرده للطالب حين طلبه واذا لم اقم برد المبلغ للطالب اعتبر مبددا وخائنا للامانه واتحمل المسئوليه الجنائيه والمدنيه نحو ارتكابى الجريمه المعاقب عليها قانونا.
            </p>

            <div class="signatures-row">
              <span class="sig-block">التوقيع</span>
              <span class="sig-block">البصمة</span>
            </div>
          </div>
        </div>
      `;
    }

    // 3. Page 3: Receipt Acknowledgment
    if (selectedDocs.receiptAck) {
      html += `
        <div class="a4-container page-break">
          <div class="title-box">
            <span class="title-text">إقـــــــرار إستلام</span>
          </div>
          
          <div class="legal-box" style="padding: 35px 30px;">
            <p class="legal-paragraph" style="text-indent: 40px; line-height: 2.4;">
              اقر انا / <span>${name}</span> المقيم / <span>${address}</span> واحمل رقم قومى / <span>${nationalId}</span> بأننى قد إستلمت المبلغ المدون به ايصال الامانه الموقع منى والمحرر على من السيد / <span>${firstPartyName}</span> لصالح السيد / <span>${thirdPartyName}</span> واننى قد استلمت هذا المبلغ نقدى وليس بضاعة وليس من حقى المنازعة بخصوص انتفاء ركن التسليم وذلك لاستلامى الفعلى لهذا المبلغ واننى ملزم برده نقدا كما اقر بان مادون بالإيصال من بيانات وكذلك التوقيع المنسوب صدوره لى صحيحين ولا يجوز لى الطعن بالتزوير عليهم امام المحكمة وفى حالة عدم الرد اكون مبددا وخائنا للامانه ولا يجوز شهادة الشهود فى اثبات وجود هذا المبلغ او الانقضاء ولا يجوز توجيه اليمين الحاسمة او اليمين المتممه منى او من وكلنى الى المستلم منى والدائن ولا تبرأ ذمتى الا بتقديم دليل كتابى يفيد سداد المبلغ المدون بهذا الايصال والموقع منى بالبصمة والامضاء الى المستفيد وفقا لنصوص قانون الاثبات.
            </p>

            <div class="signatures-row">
              <span class="sig-block">التوقيع</span>
              <span class="sig-block">البصمة</span>
            </div>
          </div>
        </div>
      `;
    }

    // 4. Page 4: Lawyer Representation Acknowledgment (3 boxes)
    if (selectedDocs.lawyerAck) {
      html += `
        <div class="a4-container page-break">
          <!-- Box 1 -->
          <div class="lawyer-title-box">
            <span class="lawyer-title-text">إقـــــــرار</span>
          </div>
          <div class="lawyer-box-item">
            <p class="lawyer-text">
              اقر انا / <span>${name}</span> واحمل رقم قومى / <span>${nationalId}</span> ومقيم بناحية / <span>${address}</span>
            </p>
            <p class="lawyer-text">
              بأننى قد وكلت الاستاذ / <span>${lawyerName}</span>
            </p>
            <p class="lawyer-text">
              بعمل ومعارضه فى القضية رقم &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; لسنة &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; جنح كفر الشيخ
            </p>
            <p class="lawyer-text">وهذا اقرار منى بذلك</p>
            <p class="lawyer-text" style="margin-top: 15px; font-weight: 850; text-align: left; padding-left: 50px;">المقر بما فيه /</p>
          </div>

          <!-- Box 2 -->
          <div class="lawyer-title-box" style="margin-top: 10px;">
            <span class="lawyer-title-text">إقـــــــرار</span>
          </div>
          <div class="lawyer-box-item">
            <p class="lawyer-text">
              اقر انا / <span>${name}</span> واحمل رقم قومى / <span>${nationalId}</span> ومقيم بناحية / <span>${address}</span>
            </p>
            <p class="lawyer-text">
              بأننى قد وكلت الاستاذ / <span>${lawyerName}</span>
            </p>
            <p class="lawyer-text">
              بعمل استئناف فى القضية رقم &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; لسنة &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; جنح كفر الشيخ
            </p>
            <p class="lawyer-text">وهذا اقرار منى بذلك</p>
            <p class="lawyer-text" style="margin-top: 15px; font-weight: 850; text-align: left; padding-left: 50px;">المقر بما فيه /</p>
          </div>

          <!-- Box 3 -->
          <div class="lawyer-title-box" style="margin-top: 10px;">
            <span class="lawyer-title-text">إقـــــــرار</span>
          </div>
          <div class="lawyer-box-item">
            <p class="lawyer-text">
              اقر انا / <span>${name}</span> واحمل رقم قومى / <span>${nationalId}</span> ومقيم بناحية / <span>${address}</span>
            </p>
            <p class="lawyer-text">
              بأننى قد وكلت الاستاذ / <span>${lawyerName}</span>
            </p>
            <p class="lawyer-text">
              بعمل ومعارضه استئنافيه فى القضية رقم &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; لسنة &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; جنح كفر الشيخ
            </p>
            <p class="lawyer-text">وهذا اقرار منى بذلك</p>
            <p class="lawyer-text" style="margin-top: 15px; font-weight: 850; text-align: left; padding-left: 50px;">المقر بما فيه /</p>
          </div>
        </div>
      `;
    }

    return html;
  };

  // Generates HTML for the Credit Purchase Application Form
  const generateCreditApplicationHtml = (todayDate: string) => {
    const custBirth = extractBirthDateFromNationalId(customer?.nationalId || '');
    
    // Guarantor 1 details
    const g1Name = customer?.guarantors?.[0]?.name || '';
    const g1NationalId = customer?.guarantors?.[0]?.nationalId || '';
    const g1Birth = extractBirthDateFromNationalId(g1NationalId);
    const g1Address = customer?.guarantors?.[0]?.address || '';
    const g1Phone = customer?.guarantors?.[0]?.phone || '';

    // Guarantor 2 details
    const g2Name = customer?.guarantors?.[1]?.name || '';
    const g2NationalId = customer?.guarantors?.[1]?.nationalId || '';
    const g2Birth = extractBirthDateFromNationalId(g2NationalId);
    const g2Address = customer?.guarantors?.[1]?.address || '';
    const g2Phone = customer?.guarantors?.[1]?.phone || '';

    // Item financing details
    const itemCode = sale.items?.[0]?.barcode || `P-${sale.items?.[0]?.productId?.substring(0, 4) || '0219'}`;
    const monthlyPayment = sale.financing?.monthlyInstallmentAmount || 0;
    const remainingVal = sale.remaining;

    return `
      <!-- طلب شراء بالآجل -->
      <div class="a4-container page-break" style="font-size: 11.5px; line-height: 1.45;">
        
        <!-- Header row -->
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 5px; border-bottom: 2px solid #000; padding-bottom: 5px;">
          <div style="font-weight: 800; font-size: 14px; text-align: right;">
            شركة المتحدة للتجارة
          </div>
          <div style="border: 2px solid #000; padding: 4px 20px; text-align: center; font-weight: 800; font-size: 15px; box-shadow: 2px 2px 0px #000;">
            طلب شراء بالآجل
          </div>
          <div style="font-family: monospace; font-size: 11px; text-align: left; font-weight: bold;">
            الهاتف: 01554830315 - 01554830316
          </div>
        </div>

        <div style="display: flex; justify-content: space-between; margin-bottom: 10px; font-weight: bold;">
          <span>رقم الطلب: ..............................</span>
          <span>ع: ..............................</span>
          <span>م المحافظة: ..............................</span>
        </div>

        <!-- Section 1: Personal info -->
        <div class="legal-box" style="display: flex; flex-direction: row; padding: 0; margin-bottom: 8px; flex-grow: 0;">
          <div class="section-vertical-title">بيانات طالب التمويل</div>
          <div class="section-content" style="padding: 10px 12px; flex-grow: 1;">
            
            <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 8px;">
              <div class="app-field-row"><span class="app-field-label">اسم مقدم الطلب:</span><span class="app-field-dots">${sale.customerName}</span></div>
              <div class="app-field-row"><span class="app-field-label">اسم الشهرة:</span><span class="app-field-dots"></span></div>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 4px;">
              <div class="app-field-row"><span class="app-field-label">بطاقة الرقم القومى:</span><span class="app-field-dots" style="font-family: monospace; font-size: 13px;">${customer?.nationalId || '---'}</span></div>
              <div class="app-field-row"><span class="app-field-label">تاريخ الميلاد:</span><span class="app-field-dots">${custBirth}</span></div>
            </div>

            <div class="app-field-row" style="margin-top: 4px;"><span class="app-field-label">عنوان السكن بالتفصيل:</span><span class="app-field-dots">${customer?.address || '---'}</span></div>

            <div style="display: grid; grid-template-columns: 1fr 1.2fr 1fr; gap: 8px; margin-top: 4px;">
              <div class="app-field-row"><span class="app-field-label">تليفون المنزل:</span><span class="app-field-dots"></span></div>
              <div class="app-field-row"><span class="app-field-label">محمول:</span><span class="app-field-dots">${customer?.phone || '---'}</span></div>
              <div class="app-field-row"><span class="app-field-label">العمل:</span><span class="app-field-dots"></span></div>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 4px;">
              <div class="app-field-row"><span class="app-field-label">المهنه الحاليه:</span><span class="app-field-dots"></span></div>
              <div class="app-field-row"><span class="app-field-label">اجمالى الدخل الشهرى:</span><span class="app-field-dots"></span></div>
            </div>

            <div class="app-field-row" style="margin-top: 4px;"><span class="app-field-label">عنوان جهه العمل الحالى:</span><span class="app-field-dots"></span></div>

            <!-- Owned Assets Checkboxes -->
            <div style="display: flex; gap: 15px; margin-top: 6px; font-weight: bold;">
              <span>الاصول المملوكة :</span>
              <span style="display: flex; align-items: center; gap: 4px;"><span style="width: 12px; height: 12px; border: 1.5px solid #000; display: inline-block;"></span> عقارات</span>
              <span style="display: flex; align-items: center; gap: 4px;"><span style="width: 12px; height: 12px; border: 1.5px solid #000; display: inline-block;"></span> اراضى</span>
              <span style="display: flex; align-items: center; gap: 4px;"><span style="width: 12px; height: 12px; border: 1.5px solid #000; display: inline-block;"></span> سيارات</span>
              <span style="display: flex; align-items: center; gap: 4px;"><span style="width: 12px; height: 12px; border: 1.5px solid #000; display: inline-block;"></span> معدات</span>
              <span style="display: flex; align-items: center; gap: 4px;"><span style="width: 12px; height: 12px; border: 1.5px solid #000; display: inline-block;"></span> اخرى</span>
            </div>

            <div style="display: flex; justify-content: flex-end; margin-top: 8px; font-weight: bold;">
              <span>توقيع مقدم الطلب: .................................................</span>
            </div>

          </div>
        </div>

        <!-- Section 2: Guarantor 1 Info -->
        <div class="legal-box" style="display: flex; flex-direction: row; padding: 0; margin-bottom: 8px; flex-grow: 0;">
          <div class="section-vertical-title" style="background-color: #f8fafc;">بيانات الضامن الأول</div>
          <div class="section-content" style="padding: 10px 12px; flex-grow: 1;">
            
            <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 8px;">
              <div class="app-field-row"><span class="app-field-label">اسم الضامن الاول:</span><span class="app-field-dots">${g1Name || '................................................'}</span></div>
              <div class="app-field-row"><span class="app-field-label">اسم الشهرة:</span><span class="app-field-dots"></span></div>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 4px;">
              <div class="app-field-row"><span class="app-field-label">بطاقة الرقم القومى:</span><span class="app-field-dots" style="font-family: monospace; font-size: 13px;">${g1NationalId || '................................................'}</span></div>
              <div class="app-field-row"><span class="app-field-label">تاريخ الميلاد:</span><span class="app-field-dots">${g1Birth !== '---' ? g1Birth : ''}</span></div>
            </div>

            <div class="app-field-row" style="margin-top: 4px;"><span class="app-field-label">عنوان السكن بالتفصيل:</span><span class="app-field-dots">${g1Address || '................................................'}</span></div>

            <div style="display: grid; grid-template-columns: 1fr 1.2fr 1fr; gap: 8px; margin-top: 4px;">
              <div class="app-field-row"><span class="app-field-label">تليفون المنزل:</span><span class="app-field-dots"></span></div>
              <div class="app-field-row"><span class="app-field-label">محمول:</span><span class="app-field-dots">${g1Phone || '................................................'}</span></div>
              <div class="app-field-row"><span class="app-field-label">العمل:</span><span class="app-field-dots"></span></div>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 4px;">
              <div class="app-field-row"><span class="app-field-label">المهنه الحاليه:</span><span class="app-field-dots"></span></div>
              <div class="app-field-row"><span class="app-field-label">اجمالى الدخل الشهرى:</span><span class="app-field-dots"></span></div>
            </div>

            <div style="display: flex; gap: 15px; margin-top: 6px; font-weight: bold;">
              <span>الاصول المملوكة :</span>
              <span style="display: flex; align-items: center; gap: 4px;"><span style="width: 12px; height: 12px; border: 1.5px solid #000; display: inline-block;"></span> عقارات</span>
              <span style="display: flex; align-items: center; gap: 4px;"><span style="width: 12px; height: 12px; border: 1.5px solid #000; display: inline-block;"></span> اراضى</span>
              <span style="display: flex; align-items: center; gap: 4px;"><span style="width: 12px; height: 12px; border: 1.5px solid #000; display: inline-block;"></span> سيارات</span>
              <span style="display: flex; align-items: center; gap: 4px;"><span style="width: 12px; height: 12px; border: 1.5px solid #000; display: inline-block;"></span> معدات</span>
              <span style="display: flex; align-items: center; gap: 4px;"><span style="width: 12px; height: 12px; border: 1.5px solid #000; display: inline-block;"></span> اخرى</span>
            </div>

            <div style="display: flex; justify-content: flex-end; margin-top: 8px; font-weight: bold;">
              <span>توقيع الضامن: .................................................</span>
            </div>

          </div>
        </div>

        <!-- Section 3: Guarantor 2 Info -->
        <div class="legal-box" style="display: flex; flex-direction: row; padding: 0; margin-bottom: 8px; flex-grow: 0;">
          <div class="section-vertical-title" style="background-color: #f8fafc;">بيانات الضامن الثاني</div>
          <div class="section-content" style="padding: 10px 12px; flex-grow: 1;">
            
            <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 8px;">
              <div class="app-field-row"><span class="app-field-label">اسم الضامن الثاني:</span><span class="app-field-dots">${g2Name || '................................................'}</span></div>
              <div class="app-field-row"><span class="app-field-label">اسم الشهرة:</span><span class="app-field-dots"></span></div>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 4px;">
              <div class="app-field-row"><span class="app-field-label">بطاقة الرقم القومى:</span><span class="app-field-dots" style="font-family: monospace; font-size: 13px;">${g2NationalId || '................................................'}</span></div>
              <div class="app-field-row"><span class="app-field-label">تاريخ الميلاد:</span><span class="app-field-dots">${g2Birth !== '---' ? g2Birth : ''}</span></div>
            </div>

            <div class="app-field-row" style="margin-top: 4px;"><span class="app-field-label">عنوان السكن بالتفصيل:</span><span class="app-field-dots">${g2Address || '................................................'}</span></div>

            <div style="display: grid; grid-template-columns: 1fr 1.2fr 1fr; gap: 8px; margin-top: 4px;">
              <div class="app-field-row"><span class="app-field-label">تليفون المنزل:</span><span class="app-field-dots"></span></div>
              <div class="app-field-row"><span class="app-field-label">محمول:</span><span class="app-field-dots">${g2Phone || '................................................'}</span></div>
              <div class="app-field-row"><span class="app-field-label">العمل:</span><span class="app-field-dots"></span></div>
            </div>

            <div style="display: flex; justify-content: flex-end; margin-top: 8px; font-weight: bold;">
              <span>توقيع الضامن: .................................................</span>
            </div>

          </div>
        </div>

        <!-- Section 4: Financing Details -->
        <div class="legal-box" style="display: flex; flex-direction: row; padding: 0; flex-grow: 1;">
          <div class="section-vertical-title" style="background-color: #f8fafc;">بيانات عن التمويل</div>
          <div class="section-content" style="padding: 10px 12px; flex-grow: 1; display: flex; flex-direction: column; justify-content: space-between;">
            
            <div>
              <div style="font-weight: 800; font-size: 12px; margin-bottom: 2px;">بيانات بأصناف المعدات والاجهزة المطلوب تمويلها:</div>
              <table style="width: 100%; border-collapse: collapse; border: 1.5px solid #000; text-align: center; font-size: 11px;">
                <thead>
                  <tr style="background-color: #f8fafc; font-weight: bold;">
                    <th style="border: 1.5px solid #000; padding: 4px;">كود الصنف</th>
                    <th style="border: 1.5px solid #000; padding: 4px;">اسم الصنف</th>
                    <th style="border: 1.5px solid #000; padding: 4px;">سعر الصنف</th>
                    <th style="border: 1.5px solid #000; padding: 4px;">المقدم</th>
                    <th style="border: 1.5px solid #000; padding: 4px;">القسط الشهري</th>
                    <th style="border: 1.5px solid #000; padding: 4px;">قيمة التمويل</th>
                  </tr>
                </thead>
                <tbody>
                  <tr style="font-weight: bold;">
                    <td style="border: 1.5px solid #000; padding: 5px; font-family: monospace;">${itemCode}</td>
                    <td style="border: 1.5px solid #000; padding: 5px;">${itemType}</td>
                    <td style="border: 1.5px solid #000; padding: 5px;">${sale.total.toLocaleString('ar-EG')}</td>
                    <td style="border: 1.5px solid #000; padding: 5px;">${sale.paid.toLocaleString('ar-EG')}</td>
                    <td style="border: 1.5px solid #000; padding: 5px;">${monthlyPayment.toLocaleString('ar-EG')}</td>
                    <td style="border: 1.5px solid #000; padding: 5px;">${remainingVal.toLocaleString('ar-EG')}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div style="margin-top: 8px; font-weight: bold;">
              <div>الغرض من التمويل : الاستخدام المنزلي / للابناء / اخرى</div>
              <div style="display: flex; justify-content: space-between; margin-top: 4px;">
                <span>فترة السداد : ${sale.financing?.installmentMonths || '---'} شهور</span>
                <span>هل سبق الحصول على قرض : نعم / لا</span>
              </div>
              <div style="display: flex; justify-content: space-between; margin-top: 4px;">
                <span>تاريخ اخر قسط : ..............................</span>
                <span>قيمته : .............................. جنية</span>
              </div>
            </div>

            <div style="display: flex; justify-content: space-between; margin-top: 15px; font-weight: 800; font-size: 12px; padding: 0 10px;">
              <span>تحريراً فى: ${todayDate}</span>
              <span>توقيع مقدم الطلب: .........................</span>
              <span>توقيع الاخصائى: .........................</span>
            </div>

          </div>
        </div>

      </div>
    `;
  };

  // NEW: Generates HTML for the Installment Statement (كشف حساب أقساط)
  const generateInstallmentStatementHtml = (todayDate: string) => {
    const schedules = sale.financing?.schedules || [];
    
    let tableHtml = '';
    
    if (schedules.length === 0) {
      tableHtml = `
        <table style="width: 100%; text-align: center; border-collapse: collapse; border: 1.5px solid #000; font-size: 12px;">
          <thead>
            <tr style="background-color: #f1f5f9; font-weight: bold; font-size: 13px;">
              <th style="border: 1.5px solid #000; padding: 8px;">البيان</th>
              <th style="border: 1.5px solid #000; padding: 8px;">تاريخ الاستحقاق</th>
              <th style="border: 1.5px solid #000; padding: 8px;">مبلغ القسط</th>
              <th style="border: 1.5px solid #000; padding: 8px;">الحالة</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan="4" style="border: 1.5px solid #000; padding: 20px; color: #64748b; font-weight: bold;">لا توجد أقساط مسجلة على هذه الفاتورة.</td>
            </tr>
          </tbody>
        </table>
      `;
    } else if (schedules.length <= 12) {
      tableHtml = `
        <table style="width: 100%; text-align: center; border-collapse: collapse; border: 1.5px solid #000; font-size: 11.5px;">
          <thead>
            <tr style="background-color: #f1f5f9; font-weight: bold; font-size: 12.5px;">
              <th style="border: 1.5px solid #000; padding: 6px;">البيان</th>
              <th style="border: 1.5px solid #000; padding: 6px;">تاريخ الاستحقاق</th>
              <th style="border: 1.5px solid #000; padding: 6px;">تاريخ الدفع</th>
              <th style="border: 1.5px solid #000; padding: 6px;">مبلغ القسط</th>
              <th style="border: 1.5px solid #000; padding: 6px;">المدفوع</th>
              <th style="border: 1.5px solid #000; padding: 6px;">المتبقي</th>
              <th style="border: 1.5px solid #000; padding: 6px;">الحالة</th>
            </tr>
          </thead>
          <tbody>
            ${schedules.map((schedule, idx) => {
              const rem = Math.max(schedule.amount - schedule.paidAmount, 0);
              const statusLabel = schedule.status === 'paid' ? 'مدفوع' : schedule.status === 'partial' ? 'جزئي' : 'غير مدفوع';
              const statusColor = schedule.status === 'paid' ? '#047857' : schedule.status === 'partial' ? '#b45309' : '#b91c1c';
              return `
                <tr style="font-weight: bold; background-color: ${idx % 2 === 0 ? '#fff' : '#f8fafc'};">
                  <td style="border: 1.5px solid #000; padding: 5px 6px;">${schedule.label}</td>
                  <td style="border: 1.5px solid #000; padding: 5px 6px; font-family: monospace;">${formatDateDisplay(schedule.dueDate)}</td>
                  <td style="border: 1.5px solid #000; padding: 5px 6px;">${formatDateDisplay(schedule.paidAt)}</td>
                  <td style="border: 1.5px solid #000; padding: 5px 6px;">${schedule.amount.toLocaleString('ar-EG')}</td>
                  <td style="border: 1.5px solid #000; padding: 5px 6px; color: #047857;">${schedule.paidAmount.toLocaleString('ar-EG')}</td>
                  <td style="border: 1.5px solid #000; padding: 5px 6px; color: #b91c1c;">${rem.toLocaleString('ar-EG')}</td>
                  <td style="border: 1.5px solid #000; padding: 5px 6px; color: ${statusColor};">${statusLabel}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      `;
    } else {
      const mid = Math.ceil(schedules.length / 2);
      const rightCols = schedules.slice(0, mid);
      const leftCols = schedules.slice(mid);
      
      const renderRows = (cols: typeof schedules) => {
        return cols.map((schedule, idx) => {
          const statusLabel = schedule.status === 'paid' ? 'مدفوع' : schedule.status === 'partial' ? 'جزئي' : 'غير مدفوع';
          const statusColor = schedule.status === 'paid' ? '#047857' : schedule.status === 'partial' ? '#b45309' : '#b91c1c';
          return `
            <tr style="font-weight: bold; background-color: ${idx % 2 === 0 ? '#fff' : '#f8fafc'};">
              <td style="border: 1.5px solid #000; padding: 4px 5px;">${schedule.label}</td>
              <td style="border: 1.5px solid #000; padding: 4px 5px; font-family: monospace;">${formatDateDisplay(schedule.dueDate)}</td>
              <td style="border: 1.5px solid #000; padding: 4px 5px;">${schedule.amount.toLocaleString('ar-EG')}</td>
              <td style="border: 1.5px solid #000; padding: 4px 5px; color: ${statusColor};">${statusLabel}</td>
            </tr>
          `;
        }).join('');
      };

      tableHtml = `
        <div style="display: flex; gap: 15px; width: 100%;">
          
          <!-- Column 1 (Right) -->
          <div style="width: 50%;">
            <table style="width: 100%; text-align: center; border-collapse: collapse; border: 1.5px solid #000; font-size: 10px;">
              <thead>
                <tr style="background-color: #f1f5f9; font-weight: bold; font-size: 11px;">
                  <th style="border: 1.5px solid #000; padding: 5px;">البيان</th>
                  <th style="border: 1.5px solid #000; padding: 5px;">الاستحقاق</th>
                  <th style="border: 1.5px solid #000; padding: 5px;">القسط</th>
                  <th style="border: 1.5px solid #000; padding: 5px;">الحالة</th>
                </tr>
              </thead>
              <tbody>
                ${renderRows(rightCols)}
              </tbody>
            </table>
          </div>

          <!-- Column 2 (Left) -->
          <div style="width: 50%;">
            <table style="width: 100%; text-align: center; border-collapse: collapse; border: 1.5px solid #000; font-size: 10px;">
              <thead>
                <tr style="background-color: #f1f5f9; font-weight: bold; font-size: 11px;">
                  <th style="border: 1.5px solid #000; padding: 5px;">البيان</th>
                  <th style="border: 1.5px solid #000; padding: 5px;">الاستحقاق</th>
                  <th style="border: 1.5px solid #000; padding: 5px;">القسط</th>
                  <th style="border: 1.5px solid #000; padding: 5px;">الحالة</th>
                </tr>
              </thead>
              <tbody>
                ${renderRows(leftCols)}
              </tbody>
            </table>
          </div>

        </div>
      `;
    }

    return `
      <!-- كشف حساب بالأقساط ومواعيد السداد -->
      <div class="a4-container page-break" style="font-size: 13px; line-height: 1.5;">
        
        <!-- Header -->
        <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #000; padding-bottom: 8px; margin-bottom: 15px;">
          <div>
            <h1 style="font-size: 22px; font-weight: 900; margin: 0 0 3px 0;">شركة المتحدة للتجارة</h1>
            <p style="color: #475569; margin: 0; font-size: 12px; font-weight: 700;">الهاتف: 01554830315 - 01554830316</p>
          </div>
          <div style="text-align: left;">
            <h2 style="font-size: 18px; font-weight: 800; border-bottom: 2px solid #000; padding-bottom: 2px; margin: 0 0 4px 0; display: inline-block;">كشف حساب أقساط العميل</h2>
            <p style="color: #475569; margin: 0; font-size: 12px; font-weight: 700;">تاريخ الطباعة: ${todayDate}</p>
          </div>
        </div>

        <!-- Customer Info Box -->
        <div style="border: 1.5px solid #000; padding: 10px; border-radius: 6px; background-color: #f8fafc; margin-bottom: 12px;">
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-weight: 700; font-size: 12.5px;">
            <p style="margin: 0;"><span style="color: #64748b;">اسم العميل:</span> ${sale.customerName}</p>
            <p style="margin: 0;"><span style="color: #64748b;">رقم الهاتف:</span> ${customer?.phone || '---'}</p>
            <p style="margin: 0; grid-column: span 2;"><span style="color: #64748b;">العنوان:</span> ${customer?.address || '---'}</p>
          </div>
        </div>

        <!-- Financial Summary Cards -->
        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-bottom: 15px;">
          <div style="border: 1.5px solid #000; padding: 8px; text-align: center; border-radius: 6px;">
            <p style="color: #64748b; font-weight: 700; margin: 0 0 2px 0; font-size: 11px;">إجمالي الفاتورة</p>
            <p style="font-size: 16px; font-weight: 900; margin: 0;">${sale.total.toLocaleString('ar-EG')} جنية</p>
          </div>
          <div style="border: 1.5px solid #059669; padding: 8px; text-align: center; border-radius: 6px; background-color: #ecfdf5;">
            <p style="color: #047857; font-weight: 700; margin: 0 0 2px 0; font-size: 11px;">إجمالي المدفوع</p>
            <p style="font-size: 16px; font-weight: 900; margin: 0; color: #065f46;">${sale.paid.toLocaleString('ar-EG')} جنية</p>
          </div>
          <div style="border: 1.5px solid #dc2626; padding: 8px; text-align: center; border-radius: 6px; background-color: #fef2f2;">
            <p style="color: #b91c1c; font-weight: 700; margin: 0 0 2px 0; font-size: 11px;">إجمالي المتبقي</p>
            <p style="font-size: 16px; font-weight: 900; margin: 0; color: #991b1b;">${sale.remaining.toLocaleString('ar-EG')} جنية</p>
          </div>
        </div>

        <!-- Table of Installments -->
        <div style="flex-grow: 1; margin-bottom: 10px;">
          <h3 style="font-size: 14px; font-weight: 800; border-bottom: 2px solid #000; padding-bottom: 4px; margin: 0 0 10px 0; display: inline-block;">جدول استحقاق الأقساط والدفعات</h3>
          ${tableHtml}
        </div>

        <!-- Footer -->
        <div style="margin-top: auto; border-top: 1.5px solid #cbd5e1; padding-top: 8px; text-align: center; color: #64748b; font-weight: bold; font-size: 11px; shrink-0;">
          <p style="margin: 0 0 2px 0;">تم استخراج كشف الحساب هذا تلقائياً من نظام المتحدة للتقسيط</p>
        </div>

      </div>
    `;
  };

  // Main printing dispatcher (either prints active party or batch prints everything)
  const handlePrint = (mode: 'active' | 'all-parties') => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert('تعذر فتح نافذة الطباعة. تأكد من السماح بالنوافذ المنبثقة.');
      return;
    }

    const todayDate = formatDateDisplay(new Date());
    const formattedInvoiceDate = formatDateDisplay(sale.date);

    let printHtml = `
      <!DOCTYPE html>
      <html lang="ar" dir="rtl">
      <head>
        <meta charset="utf-8">
        <title>طباعة الأوراق القانونية - ${sale.customerName}</title>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap');
          
          @page {
            size: A4;
            margin: 0;
          }
          
          body {
            margin: 0;
            padding: 0;
            font-family: 'Cairo', Tahoma, Arial, sans-serif;
            background-color: #fff;
            color: #000;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }

          .page-break {
            page-break-after: always;
            break-after: page;
          }

          /* A4 Container styling */
          .a4-container {
            width: 210mm;
            height: 296mm;
            padding: 12mm 15mm;
            box-sizing: border-box;
            position: relative;
            overflow: hidden;
            display: flex;
            flex-direction: column;
          }

          .title-box {
            text-align: center;
            margin: 0 auto 20px;
          }

          .title-text {
            border: 2.5px solid #000;
            padding: 5px 35px;
            font-weight: 800;
            font-size: 22px;
            display: inline-block;
            background-color: #fff;
            box-shadow: 4px 4px 0px #000;
          }

          .legal-box {
            border: 2px solid #000;
            padding: 20px 25px;
            border-radius: 4px;
            background-color: #fff;
            flex-grow: 1;
            display: flex;
            flex-direction: column;
            justify-content: flex-start;
          }

          .form-row {
            display: flex;
            align-items: center;
            margin-bottom: 14px;
            font-size: 17px;
          }

          .form-label {
            font-weight: 700;
            min-width: 140px;
            text-align: right;
          }

          .form-value {
            border-bottom: 1.5px solid #000;
            flex-grow: 1;
            text-align: center;
            font-weight: 700;
            padding-bottom: 1px;
            min-height: 24px;
          }

          .double-underline {
            font-size: 24px;
            font-weight: 800;
            border-bottom: 3.5px double #000;
            padding-bottom: 3px;
            letter-spacing: 2px;
          }

          .legal-paragraph {
            text-align: justify;
            line-height: 2.3;
            font-size: 16.5px;
            font-weight: 600;
            margin-top: 15px;
            margin-bottom: 35px;
            text-indent: 40px;
          }

          .legal-paragraph span {
            border-bottom: 1.5px solid #000;
            padding: 0 8px;
            font-weight: 800;
          }

          .signatures-row {
            display: flex;
            justify-content: space-between;
            margin-top: auto;
            padding: 20px 50px 10px;
          }

          .sig-block {
            font-weight: 800;
            font-size: 18px;
            text-align: center;
          }

          /* Lawyer Representation specific styling */
          .lawyer-box-item {
            border: 2px solid #000;
            padding: 12px 18px;
            border-radius: 4px;
            margin-bottom: 18px;
            flex-grow: 1;
            display: flex;
            flex-direction: column;
          }

          .lawyer-title-box {
            text-align: center;
            margin-bottom: 8px;
          }

          .lawyer-title-text {
            border: 2px solid #000;
            padding: 2px 25px;
            font-weight: 800;
            font-size: 15px;
            display: inline-block;
            box-shadow: 3px 3px 0px #000;
            background-color: #fff;
          }

          .lawyer-text {
            font-size: 13.5px;
            line-height: 1.9;
            font-weight: 700;
            text-align: justify;
            margin: 5px 0;
          }

          .lawyer-text span {
            border-bottom: 1.2px solid #000;
            padding: 0 4px;
            font-weight: 800;
          }

          /* Credit application specific styles */
          .section-vertical-title {
            width: 32px;
            border-left: 2px solid #000;
            writing-mode: vertical-rl;
            text-orientation: mixed;
            transform: rotate(180deg);
            text-align: center;
            font-weight: 800;
            font-size: 13.5px;
            padding: 8px 4px;
            background-color: #f8fafc;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          .section-content {
            flex-grow: 1;
            padding: 10px 15px;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
          }
          .app-field-row {
            display: flex;
            align-items: center;
          }
          .app-field-label {
            font-weight: 700;
            margin-left: 5px;
            white-space: nowrap;
          }
          .app-field-dots {
            border-bottom: 1.5px dotted #000;
            flex-grow: 1;
            min-height: 18px;
            text-align: center;
            font-weight: 700;
            padding: 0 4px;
          }
        </style>
      </head>
      <body>
    `;

    // Print credit application first if selected
    if (selectedDocs.creditApplication) {
      printHtml += generateCreditApplicationHtml(todayDate);
    }

    // Print installment statement next if selected
    if (selectedDocs.installmentStatement) {
      printHtml += generateInstallmentStatementHtml(todayDate);
    }

    if (mode === 'active') {
      // Print active party's documents
      printHtml += generateSignatoryHtml(selectedSignatory, todayDate, formattedInvoiceDate);
    } else {
      // Print Customer AND all active Guarantors documents sequentially
      printHtml += generateSignatoryHtml('customer', todayDate, formattedInvoiceDate);
      
      activeGuarantors.forEach((guarantor) => {
        printHtml += generateSignatoryHtml(guarantor.key as any, todayDate, formattedInvoiceDate);
      });
    }

    printHtml += `
      </body>
      </html>
    `;

    printWindow.document.open();
    printWindow.document.write(printHtml);
    printWindow.document.close();
    printWindow.focus();

    // Small delay to ensure styles and fonts are loaded before triggering print
    printWindow.onload = () => {
      printWindow.print();
    };

    if (onSuccess) {
      onSuccess();
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/60 backdrop-blur-sm p-4 sm:p-6 flex items-center justify-center">
      <div className="relative bg-slate-900 border border-slate-800 text-white rounded-[28px] w-full max-w-6xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-slate-950 border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-sky-500/10 flex items-center justify-center text-sky-400">
              <Printer size={20} />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">طباعة الأوراق القانونية وطلب الشراء</h3>
              <p className="text-xs text-slate-400">تجهيز وتعديل مستندات العميل: {sale.customerName}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white rounded-xl p-2 hover:bg-slate-800 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 xl:grid-cols-[400px_1fr] gap-6">
          
          {/* Controls Panel */}
          <div className="space-y-5 flex flex-col justify-start">
            
            {/* Signatory selection tab */}
            {activeGuarantors.length > 0 && (
              <div className="bg-slate-950/50 border border-slate-800 rounded-2xl p-4 space-y-3">
                <h4 className="font-bold text-sm text-sky-400 flex items-center gap-2 mb-1">
                  <Users size={16} />
                  اختر الطرف الملتزم للطباعة والمعاينة
                </h4>
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedSignatory('customer')}
                    className={`w-full px-4 py-2.5 rounded-xl text-xs font-bold text-right transition-all border flex items-center justify-between ${selectedSignatory === 'customer' ? 'bg-sky-500 border-sky-500 text-slate-950' : 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white'}`}
                  >
                    <span>العميل المشتري</span>
                    <span className="font-semibold text-[10px] bg-slate-950/20 px-2 py-0.5 rounded">{sale.customerName}</span>
                  </button>
                  {activeGuarantors.map((g) => (
                    <button
                      key={g.key}
                      type="button"
                      onClick={() => setSelectedSignatory(g.key as any)}
                      className={`w-full px-4 py-2.5 rounded-xl text-xs font-bold text-right transition-all border flex items-center justify-between ${selectedSignatory === g.key ? 'bg-sky-500 border-sky-500 text-slate-950' : 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white'}`}
                    >
                      <span>{g.label}</span>
                      <span className="font-semibold text-[10px] bg-slate-950/20 px-2 py-0.5 rounded">{g.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Document Selection checkboxes */}
            <div className="bg-slate-950/50 border border-slate-800 rounded-2xl p-4 space-y-3">
              <h4 className="font-bold text-sm text-sky-400 flex items-center gap-2 mb-2">
                <CheckSquare size={16} />
                تحديد المستندات للطباعة
              </h4>

              <label className="flex items-center gap-3 cursor-pointer group py-1 text-sm text-slate-200">
                <input
                  type="checkbox"
                  checked={selectedDocs.creditApplication}
                  onChange={(e) => setSelectedDocs({ ...selectedDocs, creditApplication: e.target.checked })}
                  className="rounded border-slate-700 bg-slate-800 text-sky-500 focus:ring-sky-500 w-4 h-4"
                />
                طلب شراء بالآجل (شامل التمويل والضامنين)
              </label>

              <label className="flex items-center gap-3 cursor-pointer group py-1 text-sm text-slate-200">
                <input
                  type="checkbox"
                  checked={selectedDocs.installmentStatement}
                  onChange={(e) => setSelectedDocs({ ...selectedDocs, installmentStatement: e.target.checked })}
                  className="rounded border-slate-700 bg-slate-800 text-sky-500 focus:ring-sky-500 w-4 h-4"
                />
                كشف حساب الأقساط وجدول السداد
              </label>
              
              <label className="flex items-center gap-3 cursor-pointer group py-1 text-sm text-slate-200">
                <input
                  type="checkbox"
                  checked={selectedDocs.customerFile && selectedDocs.saleStatement}
                  onChange={(e) => setSelectedDocs({ 
                    ...selectedDocs, 
                    customerFile: e.target.checked,
                    saleStatement: e.target.checked
                  })}
                  className="rounded border-slate-700 bg-slate-800 text-sky-500 focus:ring-sky-500 w-4 h-4"
                />
                {selectedSignatory === 'customer' ? 'ملف العميل وبيان بيع السلعة' : `ملف ${selectedSignatory === 'guarantor1' ? 'الضامن الأول' : selectedSignatory === 'guarantor2' ? 'الضامن الثاني' : 'الضامن الثالث'} وبيان بيع السلعة`}
              </label>

              <label className="flex items-center gap-3 cursor-pointer group py-1 text-sm text-slate-200">
                <input
                  type="checkbox"
                  checked={selectedDocs.trustReceipt}
                  onChange={(e) => setSelectedDocs({ ...selectedDocs, trustReceipt: e.target.checked })}
                  className="rounded border-slate-700 bg-slate-800 text-sky-500 focus:ring-sky-500 w-4 h-4"
                />
                إيصال أمانة
              </label>

              <label className="flex items-center gap-3 cursor-pointer group py-1 text-sm text-slate-200">
                <input
                  type="checkbox"
                  checked={selectedDocs.receiptAck}
                  onChange={(e) => setSelectedDocs({ ...selectedDocs, receiptAck: e.target.checked })}
                  className="rounded border-slate-700 bg-slate-800 text-sky-500 focus:ring-sky-500 w-4 h-4"
                />
                إقرار إستلام الأمانة نقداً
              </label>

              <label className="flex items-center gap-3 cursor-pointer group py-1 text-sm text-slate-200">
                <input
                  type="checkbox"
                  checked={selectedDocs.lawyerAck}
                  onChange={(e) => setSelectedDocs({ ...selectedDocs, lawyerAck: e.target.checked })}
                  className="rounded border-slate-700 bg-slate-800 text-sky-500 focus:ring-sky-500 w-4 h-4"
                />
                إقرارات توكيل قضايا (3 إقرارات)
              </label>
            </div>

            {/* Custom Variables forms */}
            <div className="bg-slate-950/50 border border-slate-800 rounded-2xl p-4 space-y-4">
              <h4 className="font-bold text-sm text-sky-400 flex items-center gap-2 mb-1">
                <Settings size={16} />
                تعديل المتغيرات القانونية
              </h4>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-bold text-slate-400 mb-1">الطرف الأول (المُسلِم)</label>
                  <input
                    type="text"
                    value={firstPartyName}
                    onChange={(e) => setFirstPartyName(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-sky-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-400 mb-1">الطرف الثالث (المُستلِم منه)</label>
                  <input
                    type="text"
                    value={thirdPartyName}
                    onChange={(e) => setThirdPartyName(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-sky-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-400 mb-1">اسم المحامي الموكّل</label>
                  <input
                    type="text"
                    value={lawyerName}
                    onChange={(e) => setLawyerName(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-sky-500"
                  />
                </div>

                <button
                  type="button"
                  onClick={handleSaveDefaults}
                  className="w-full text-center text-xs text-sky-400 hover:text-sky-300 font-bold underline transition-colors pt-1"
                >
                  حفظ هذه الأسماء كوضع افتراضي دائم
                </button>

                <div className="border-t border-slate-800 my-2 pt-3">
                  <label className="block text-xs font-bold text-slate-400 mb-1">نوع السلعة</label>
                  <input
                    type="text"
                    value={itemType}
                    onChange={(e) => setItemType(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-sky-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-400 mb-1">المبلغ المالي للالتزام</label>
                  <input
                    type="number"
                    value={amount}
                    onChange={(e) => handleAmountChange(Number(e.target.value) || 0)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-sky-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-400 mb-1">صيغة التفقيط (القرائة بالعربية)</label>
                  <textarea
                    value={amountInWords}
                    onChange={(e) => setAmountInWords(e.target.value)}
                    rows={2}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-sky-500 resize-none"
                  />
                </div>
              </div>
            </div>

          </div>

          {/* Live Preview Panel */}
          <div className="bg-slate-950 border border-slate-800 rounded-2xl flex flex-col h-[650px] overflow-hidden">
            
            {/* Preview Navigation Tabs */}
            <div className="flex border-b border-slate-800 bg-slate-950 p-2 gap-2 shrink-0 overflow-x-auto">
              <button
                onClick={() => setActivePreviewTab('creditApplication')}
                className={`px-3 py-1.5 text-xs font-bold rounded-lg whitespace-nowrap transition-colors flex items-center gap-1.5 ${activePreviewTab === 'creditApplication' ? 'bg-sky-500 text-slate-950' : 'text-slate-400 hover:text-white hover:bg-slate-900'}`}
              >
                <FileText size={13} />
                طلب شراء بالآجل
              </button>
              <button
                onClick={() => setActivePreviewTab('installmentStatement')}
                className={`px-3 py-1.5 text-xs font-bold rounded-lg whitespace-nowrap transition-colors flex items-center gap-1.5 ${activePreviewTab === 'installmentStatement' ? 'bg-sky-500 text-slate-950' : 'text-slate-400 hover:text-white hover:bg-slate-900'}`}
              >
                <Calendar size={13} />
                كشف حساب الأقساط
              </button>
              <button
                onClick={() => setActivePreviewTab('customerFile')}
                className={`px-3 py-1.5 text-xs font-bold rounded-lg whitespace-nowrap transition-colors ${activePreviewTab === 'customerFile' ? 'bg-sky-500 text-slate-950' : 'text-slate-400 hover:text-white hover:bg-slate-900'}`}
              >
                {selectedSignatory === 'customer' ? 'ملف العميل وبيان البيع' : 'ملف الضامن وبيان البيع'}
              </button>
              <button
                onClick={() => setActivePreviewTab('trustReceipt')}
                className={`px-3 py-1.5 text-xs font-bold rounded-lg whitespace-nowrap transition-colors ${activePreviewTab === 'trustReceipt' ? 'bg-sky-500 text-slate-950' : 'text-slate-400 hover:text-white hover:bg-slate-900'}`}
              >
                إيصال الأمانة
              </button>
              <button
                onClick={() => setActivePreviewTab('receiptAck')}
                className={`px-3 py-1.5 text-xs font-bold rounded-lg whitespace-nowrap transition-colors ${activePreviewTab === 'receiptAck' ? 'bg-sky-500 text-slate-950' : 'text-slate-400 hover:text-white hover:bg-slate-900'}`}
              >
                إقرار الإستلام
              </button>
              <button
                onClick={() => setActivePreviewTab('lawyerAck')}
                className={`px-3 py-1.5 text-xs font-bold rounded-lg whitespace-nowrap transition-colors ${activePreviewTab === 'lawyerAck' ? 'bg-sky-500 text-slate-950' : 'text-slate-400 hover:text-white hover:bg-slate-900'}`}
              >
                توكيل القضايا (3 إقرارات)
              </button>
            </div>

            {/* Simulated Printed Page Wrapper */}
            <div className="flex-1 overflow-y-auto p-6 bg-slate-900/60 flex justify-center items-start">
              
              {/* Credit Application Preview */}
              {activePreviewTab === 'creditApplication' && (
                <div className="bg-white text-black p-6 shadow-xl border border-slate-300 w-full max-w-[650px] rounded animate-in fade-in duration-200" style={{ fontFamily: 'Tahoma, sans-serif', direction: 'rtl', fontSize: '9px', lineHeight: '1.4' }}>
                  
                  {/* Header Row */}
                  <div className="flex justify-between items-start border-b-2 border-black pb-1 mb-1">
                    <span className="font-extrabold text-[11px]">شركة المتحدة للتجارة</span>
                    <span className="border border-black px-4 py-0.5 font-extrabold text-[11px] bg-slate-100 shadow-[1px_1px_0_black]">طلب شراء بالآجل</span>
                    <span className="font-bold text-[8px] font-mono">الهاتف: 01554830315 - 01554830316</span>
                  </div>

                  <div className="flex justify-between mb-1.5 font-bold text-[8px]">
                    <span>رقم الطلب: ..............................</span>
                    <span>ع: ..............................</span>
                    <span>م المحافظة: ..............................</span>
                  </div>

                  {/* Section 1: Customer Personal Details */}
                  <div className="border border-black flex mb-1.5 rounded overflow-hidden">
                    <div className="w-[20px] bg-slate-50 border-l border-black font-extrabold text-[9px] flex items-center justify-center text-center py-2" style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>
                      بيانات طالب التمويل
                    </div>
                    <div className="flex-1 p-2 space-y-1">
                      <div className="grid grid-cols-3 gap-1">
                        <div className="col-span-2 flex"><span className="font-bold ml-1 whitespace-nowrap">اسم مقدم الطلب:</span><span className="border-b border-black flex-1 font-bold">{sale.customerName}</span></div>
                        <div className="flex"><span className="font-bold ml-1 whitespace-nowrap">اسم الشهرة:</span><span className="border-b border-black flex-1"></span></div>
                      </div>
                      <div className="grid grid-cols-2 gap-1">
                        <div className="flex"><span className="font-bold ml-1 whitespace-nowrap">بطاقة الرقم القومى:</span><span className="border-b border-black flex-1 font-bold font-mono text-[10px]">{customer?.nationalId || '---'}</span></div>
                        <div className="flex"><span className="font-bold ml-1 whitespace-nowrap">تاريخ الميلاد:</span><span className="border-b border-black flex-1 font-bold">{extractBirthDateFromNationalId(customer?.nationalId || '')}</span></div>
                      </div>
                      <div className="flex"><span className="font-bold ml-1 whitespace-nowrap">عنوان السكن بالتفصيل:</span><span className="border-b border-black flex-1 font-bold">{customer?.address || '---'}</span></div>
                      <div className="grid grid-cols-3 gap-1">
                        <div className="flex"><span className="font-bold ml-1 whitespace-nowrap">تليفون المنزل:</span><span className="border-b border-black flex-1"></span></div>
                        <div className="flex"><span className="font-bold ml-1 whitespace-nowrap">محمول:</span><span className="border-b border-black flex-1 font-bold">{customer?.phone || '---'}</span></div>
                        <div className="flex"><span className="font-bold ml-1 whitespace-nowrap">العمل:</span><span className="border-b border-black flex-1"></span></div>
                      </div>
                      <div className="grid grid-cols-2 gap-1">
                        <div className="flex"><span className="font-bold ml-1 whitespace-nowrap">المهنه الحاليه:</span><span className="border-b border-black flex-1"></span></div>
                        <div className="flex"><span className="font-bold ml-1 whitespace-nowrap">اجمالى الدخل الشهرى:</span><span className="border-b border-black flex-1"></span></div>
                      </div>
                      {/* Owned Assets */}
                      <div className="flex gap-3 pt-0.5 font-bold text-[8px]">
                        <span>الأصول المملوكة:</span>
                        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 border border-black inline-block"></span> عقارات</span>
                        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 border border-black inline-block"></span> أراضى</span>
                        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 border border-black inline-block"></span> سيارات</span>
                        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 border border-black inline-block"></span> معدات</span>
                        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 border border-black inline-block"></span> أخرى</span>
                      </div>
                      <div className="flex justify-end pt-1 font-bold text-[8px]">
                        <span>توقيع مقدم الطلب: .................................................</span>
                      </div>
                    </div>
                  </div>

                  {/* Section 2: Guarantor 1 Details */}
                  <div className="border border-black flex mb-1.5 rounded overflow-hidden">
                    <div className="w-[20px] bg-slate-50 border-l border-black font-extrabold text-[9px] flex items-center justify-center text-center py-2" style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>
                      بيانات الضامن الأول
                    </div>
                    <div className="flex-1 p-2 space-y-1">
                      <div className="grid grid-cols-3 gap-1">
                        <div className="col-span-2 flex"><span className="font-bold ml-1 whitespace-nowrap">اسم الضامن الاول:</span><span className="border-b border-black flex-1 font-bold">{customer?.guarantors?.[0]?.name || '................................................'}</span></div>
                        <div className="flex"><span className="font-bold ml-1 whitespace-nowrap">اسم الشهرة:</span><span className="border-b border-black flex-1"></span></div>
                      </div>
                      <div className="grid grid-cols-2 gap-1">
                        <div className="flex"><span className="font-bold ml-1 whitespace-nowrap">بطاقة الرقم القومى:</span><span className="border-b border-black flex-1 font-bold font-mono">{customer?.guarantors?.[0]?.nationalId || '................................................'}</span></div>
                        <div className="flex"><span className="font-bold ml-1 whitespace-nowrap">تاريخ الميلاد:</span><span className="border-b border-black flex-1 font-bold">{customer?.guarantors?.[0]?.nationalId ? extractBirthDateFromNationalId(customer.guarantors[0].nationalId) : ''}</span></div>
                      </div>
                      <div className="flex"><span className="font-bold ml-1 whitespace-nowrap">عنوان السكن بالتفصيل:</span><span className="border-b border-black flex-1 font-bold">{customer?.guarantors?.[0]?.address || '................................................'}</span></div>
                      <div className="grid grid-cols-3 gap-1">
                        <div className="flex"><span className="font-bold ml-1 whitespace-nowrap">تليفون المنزل:</span><span className="border-b border-black flex-1"></span></div>
                        <div className="flex"><span className="font-bold ml-1 whitespace-nowrap">محمول:</span><span className="border-b border-black flex-1 font-bold">{customer?.guarantors?.[0]?.phone || '................................................'}</span></div>
                        <div className="flex"><span className="font-bold ml-1 whitespace-nowrap">العمل:</span><span className="border-b border-black flex-1"></span></div>
                      </div>
                      <div className="flex gap-3 pt-0.5 font-bold text-[8px]">
                        <span>الأصول المملوكة:</span>
                        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 border border-black inline-block"></span> عقارات</span>
                        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 border border-black inline-block"></span> أراضى</span>
                        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 border border-black inline-block"></span> سيارات</span>
                        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 border border-black inline-block"></span> معدات</span>
                      </div>
                      <div className="flex justify-end pt-1 font-bold text-[8px]">
                        <span>توقيع الضامن: .................................................</span>
                      </div>
                    </div>
                  </div>

                  {/* Section 3: Guarantor 2 Details */}
                  <div className="border border-black flex mb-1.5 rounded overflow-hidden">
                    <div className="w-[20px] bg-slate-50 border-l border-black font-extrabold text-[9px] flex items-center justify-center text-center py-2" style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>
                      بيانات الضامن الثاني
                    </div>
                    <div className="flex-1 p-2 space-y-1">
                      <div className="grid grid-cols-3 gap-1">
                        <div className="col-span-2 flex"><span className="font-bold ml-1 whitespace-nowrap">اسم الضامن الثاني:</span><span className="border-b border-black flex-1 font-bold">{customer?.guarantors?.[1]?.name || '................................................'}</span></div>
                        <div className="flex"><span className="font-bold ml-1 whitespace-nowrap">اسم الشهرة:</span><span className="border-b border-black flex-1"></span></div>
                      </div>
                      <div className="grid grid-cols-2 gap-1">
                        <div className="flex"><span className="font-bold ml-1 whitespace-nowrap">بطاقة الرقم القومى:</span><span className="border-b border-black flex-1 font-bold font-mono">{customer?.guarantors?.[1]?.nationalId || '................................................'}</span></div>
                        <div className="flex"><span className="font-bold ml-1 whitespace-nowrap">تاريخ الميلاد:</span><span className="border-b border-black flex-1 font-bold">{customer?.guarantors?.[1]?.nationalId ? extractBirthDateFromNationalId(customer.guarantors[1].nationalId) : ''}</span></div>
                      </div>
                      <div className="flex"><span className="font-bold ml-1 whitespace-nowrap">عنوان السكن بالتفصيل:</span><span className="border-b border-black flex-1 font-bold">{customer?.guarantors?.[1]?.address || '................................................'}</span></div>
                      <div className="flex justify-end pt-1 font-bold text-[8px]">
                        <span>توقيع الضامن: .................................................</span>
                      </div>
                    </div>
                  </div>

                  {/* Section 4: Financing Table & details */}
                  <div className="border border-black flex rounded overflow-hidden">
                    <div className="w-[20px] bg-slate-50 border-l border-black font-extrabold text-[9px] flex items-center justify-center text-center py-2" style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>
                      بيانات عن التمويل
                    </div>
                    <div className="flex-1 p-2 flex flex-col justify-between">
                      <div>
                        <div className="font-bold text-[8px] mb-0.5">بيانات بأصناف المعدات والاجهزة المطلوب تمويلها:</div>
                        <table className="w-full border-collapse border border-black text-center text-[8px]">
                          <thead>
                            <tr className="bg-slate-50 font-bold">
                              <th className="border border-black p-1">كود الصنف</th>
                              <th className="border border-black p-1">اسم الصنف</th>
                              <th className="border border-black p-1">سعر الصنف</th>
                              <th className="border border-black p-1">المقدم</th>
                              <th className="border border-black p-1">القسط الشهري</th>
                              <th className="border border-black p-1">قيمة التمويل</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr className="font-bold">
                              <td className="border border-black p-1 font-mono">{sale.items?.[0]?.barcode || `P-${sale.items?.[0]?.productId?.substring(0, 4) || '0219'}`}</td>
                              <td className="border border-black p-1">{itemType}</td>
                              <td className="border border-black p-1">{sale.total.toLocaleString('ar-EG')}</td>
                              <td className="border border-black p-1">{sale.paid.toLocaleString('ar-EG')}</td>
                              <td className="border border-black p-1">{(sale.financing?.monthlyInstallmentAmount || 0).toLocaleString('ar-EG')}</td>
                              <td className="border border-black p-1">{sale.remaining.toLocaleString('ar-EG')}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>

                      <div className="grid grid-cols-2 gap-x-4 pt-1.5 font-bold text-[8px]">
                        <span>الغرض من التمويل: الاستخدام المنزلي / للابناء / اخرى</span>
                        <span>فترة السداد: {sale.financing?.installmentMonths || '---'} شهور</span>
                        <span>هل سبق الحصول على قرض: نعم / لا</span>
                        <span>تاريخ اخر قسط: ..............................</span>
                      </div>

                      <div className="flex justify-between pt-3 font-extrabold text-[8px]">
                        <span>تحريراً فى: {formatDateDisplay(new Date())}</span>
                        <span>توقيع مقدم الطلب: .........................</span>
                        <span>توقيع الاخصائى: .........................</span>
                      </div>
                    </div>
                  </div>

                </div>
              )}

              {/* NEW: Installment Statement Preview */}
              {activePreviewTab === 'installmentStatement' && (
                <div className="bg-white text-black p-8 shadow-xl border border-slate-300 w-full max-w-[650px] space-y-6 rounded animate-in fade-in duration-200" style={{ fontFamily: 'Tahoma, sans-serif', direction: 'rtl', fontSize: '12px' }}>
                  
                  {/* Header Row */}
                  <div className="flex justify-between items-start border-b-2 border-black pb-3 mb-3">
                    <div>
                      <h1 className="font-black text-lg">شركة المتحدة للتجارة</h1>
                      <p className="text-[10px] text-slate-500 font-bold">العنوان: كفر الشيخ</p>
                      <p className="text-[10px] text-slate-500 font-bold">الهاتف: 01554830315 - 01554830316</p>
                    </div>
                    <div className="text-left">
                      <h2 className="border-b-2 border-black pb-0.5 font-extrabold text-md inline-block">كشف حساب أقساط العميل</h2>
                      <p className="text-[10px] text-slate-500 font-bold">تاريخ الطباعة: {formatDateDisplay(new Date())}</p>
                      <p className="text-[10px] text-slate-500 font-bold">رقم الفاتورة: {sale.invoiceNumber}</p>
                    </div>
                  </div>

                  {/* Customer Info Box */}
                  <div className="border border-black p-4 rounded bg-slate-50/50 space-y-1">
                    <h3 className="font-bold text-xs border-b border-slate-200 pb-1 text-slate-700">بيانات العميل المشتري</h3>
                    <div className="grid grid-cols-2 gap-1 text-[11px] font-bold">
                      <p><span className="text-slate-400">اسم العميل:</span> {sale.customerName}</p>
                      <p><span className="text-slate-400">رقم الهاتف:</span> {customer?.phone || '---'}</p>
                      <p className="col-span-2"><span className="text-slate-400">العنوان:</span> {customer?.address || '---'}</p>
                    </div>
                  </div>

                  {/* Financial Summary Cards */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="border border-black p-2 text-center rounded bg-white">
                      <p className="text-slate-400 font-bold text-[9px] mb-0.5">إجمالي الفاتورة</p>
                      <p className="text-sm font-black">{sale.total.toLocaleString('ar-EG')} جنية</p>
                    </div>
                    <div className="border border-emerald-600 p-2 text-center rounded bg-emerald-50/30">
                      <p className="text-emerald-700 font-bold text-[9px] mb-0.5">إجمالي المدفوع</p>
                      <p className="text-sm font-black text-emerald-800">{sale.paid.toLocaleString('ar-EG')} جنية</p>
                    </div>
                    <div className="border border-red-600 p-2 text-center rounded bg-red-50/30">
                      <p className="text-red-700 font-bold text-[9px] mb-0.5">إجمالي المتبقي</p>
                      <p className="text-sm font-black text-red-800">{sale.remaining.toLocaleString('ar-EG')} جنية</p>
                    </div>
                  </div>

                  {/* Table of Installments */}
                  <div className="space-y-1">
                    <h3 className="font-bold text-xs border-b-2 border-black pb-0.5 inline-block">جدول استحقاق الأقساط والدفعات</h3>
                    <table className="w-full text-center border-collapse border border-black text-[10px]">
                      <thead>
                        <tr className="bg-slate-100 font-bold">
                          <th className="border border-black p-1.5">البيان</th>
                          <th className="border border-black p-1.5">تاريخ الاستحقاق</th>
                          <th className="border border-black p-1.5">تاريخ الدفع</th>
                          <th className="border border-black p-1.5">مبلغ القسط</th>
                          <th className="border border-black p-1.5">المدفوع</th>
                          <th className="border border-black p-1.5">المتبقي</th>
                          <th className="border border-black p-1.5">الحالة</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(sale.financing?.schedules || []).length === 0 ? (
                          <tr>
                            <td colSpan={7} className="border border-black p-4 text-slate-400 font-bold">لا توجد أقساط مسجلة على هذه الفاتورة.</td>
                          </tr>
                        ) : (sale.financing?.schedules || []).length <= 12 ? (
                          (sale.financing?.schedules || []).map((schedule, idx) => {
                            const rem = Math.max(schedule.amount - schedule.paidAmount, 0);
                            const statusLabel = schedule.status === 'paid' ? 'مدفوع' : schedule.status === 'partial' ? 'جزئي' : 'غير مدفوع';
                            const statusColor = schedule.status === 'paid' ? 'text-emerald-700' : schedule.status === 'partial' ? 'text-amber-700' : 'text-red-700';
                            
                            return (
                              <tr key={schedule.id} className="font-bold odd:bg-slate-50/30">
                                <td className="border border-black p-1.5">{schedule.label}</td>
                                <td className="border border-black p-1.5 font-mono">{formatDateDisplay(schedule.dueDate)}</td>
                                <td className="border border-black p-1.5">{formatDateDisplay(schedule.paidAt)}</td>
                                <td className="border border-black p-1.5">{schedule.amount.toLocaleString('ar-EG')}</td>
                                <td className="border border-black p-1.5 text-emerald-700">{schedule.paidAmount.toLocaleString('ar-EG')}</td>
                                <td className="border border-black p-1.5 text-red-700">{rem.toLocaleString('ar-EG')}</td>
                                <td className={`border border-black p-1.5 ${statusColor}`}>{statusLabel}</td>
                              </tr>
                            );
                          })
                        ) : (
                          // Render side-by-side informational badge
                          <tr>
                            <td colSpan={7} className="border border-black p-6 text-sky-800 bg-sky-50 font-bold text-center">
                              💡 يوجد أكثر من 12 قسطاً. لتوفير مساحة الورق وضمان ملاءمتها لصفحة واحدة (كشف حساب واحد)، سيتم طباعتها تلقائياً في عمودين متجاورين عند الطباعة الفعلية!
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* Footer */}
                  <div className="border-t border-slate-300 pt-3 text-center text-slate-400 font-bold text-[9px]">
                    <p className="mb-0.5">يسعدنا دائماً خدمتكم وثقتكم بنا هي أساس نجاحنا</p>
                    <p>تم استخراج كشف الحساب هذا تلقائياً من نظام المتحدة للتقسيط</p>
                  </div>
                </div>
              )}

              {/* Customer/Guarantor File Preview */}
              {activePreviewTab === 'customerFile' && (
                <div className="bg-white text-black p-6 shadow-xl border border-slate-300 w-full max-w-[650px] space-y-4 rounded animate-in fade-in duration-200 font-bold" style={{ fontFamily: 'Tahoma, sans-serif', direction: 'rtl', fontSize: '12px' }}>
                  
                  {/* Combined Header */}
                  <div className="text-center">
                    <span className="border-2 border-black px-6 py-1 font-bold text-md inline-block shadow-[3px_3px_0_black]">{fileTitle} وبيان بيع السلعة</span>
                  </div>
                  
                  {/* Unified Table */}
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px', border: '1.5px solid #000' }}>
                    <tbody>
                      <tr>
                        <td style={{ border: '1.5px solid #000', padding: '4px 6px', backgroundColor: '#f8fafc', width: '18%' }}>الاسم:</td>
                        <td style={{ border: '1.5px solid #000', padding: '4px 6px', width: '32%' }}>{signatoryName}</td>
                        <td style={{ border: '1.5px solid #000', padding: '4px 6px', backgroundColor: '#f8fafc', width: '18%' }}>{selectedSignatory === 'customer' ? 'رقم العميل:' : 'رقم الضامن:'}</td>
                        <td style={{ border: '1.5px solid #000', padding: '4px 6px', width: '32%', fontFamily: 'monospace', textAlign: 'center' }}>{selectedSignatory === 'customer' ? (customer?.customerNumber || '---') : 'ضامن'}</td>
                      </tr>
                      <tr>
                        <td style={{ border: '1.5px solid #000', padding: '4px 6px', backgroundColor: '#f8fafc' }}>العنوان:</td>
                        <td style={{ border: '1.5px solid #000', padding: '4px 6px' }} colSpan={3}>{signatoryAddress}</td>
                      </tr>
                      <tr>
                        <td style={{ border: '1.5px solid #000', padding: '4px 6px', backgroundColor: '#f8fafc' }}>الرقم القومى:</td>
                        <td style={{ border: '1.5px solid #000', padding: '4px 6px', fontFamily: 'monospace', textAlign: 'center' }}>{signatoryNationalId}</td>
                        <td style={{ border: '1.5px solid #000', padding: '4px 6px', backgroundColor: '#f8fafc' }}>رقم الموبايل:</td>
                        <td style={{ border: '1.5px solid #000', padding: '4px 6px', fontFamily: 'monospace', textAlign: 'center' }}>{signatoryPhone}</td>
                      </tr>
                      <tr>
                        <td style={{ border: '1.5px solid #000', padding: '4px 6px', backgroundColor: '#f8fafc' }}>نوع السلعة:</td>
                        <td style={{ border: '1.5px solid #000', padding: '4px 6px' }}>{itemType}</td>
                        <td style={{ border: '1.5px solid #000', padding: '4px 6px', backgroundColor: '#f8fafc' }}>سعر السلعة:</td>
                        <td style={{ border: '1.5px solid #000', padding: '4px 6px', textAlign: 'center' }}>{sale.total.toLocaleString('ar-EG')} ج.م</td>
                      </tr>
                      <tr>
                        <td style={{ border: '1.5px solid #000', padding: '4px 6px', backgroundColor: '#f8fafc' }}>المبلغ المدفوع:</td>
                        <td style={{ border: '1.5px solid #000', padding: '4px 6px', color: '#047857', textAlign: 'center' }}>{sale.paid.toLocaleString('ar-EG')} ج.م</td>
                        <td style={{ border: '1.5px solid #000', padding: '4px 6px', backgroundColor: '#f8fafc' }}>المبلغ المتبقى:</td>
                        <td style={{ border: '1.5px solid #000', padding: '4px 6px', color: '#b91c1c', textAlign: 'center' }}>{sale.remaining.toLocaleString('ar-EG')} ج.م</td>
                      </tr>
                      <tr>
                        <td style={{ border: '1.5px solid #000', padding: '4px 6px', backgroundColor: '#f8fafc' }}>أشهر التقسيط:</td>
                        <td style={{ border: '1.5px solid #000', padding: '4px 6px', textAlign: 'center' }}>{sale.financing?.installmentMonths || '---'} شهر</td>
                        <td style={{ border: '1.5px solid #000', padding: '4px 6px', backgroundColor: '#f8fafc' }}>تاريخ التعاقد:</td>
                        <td style={{ border: '1.5px solid #000', padding: '4px 6px', fontFamily: 'monospace', textAlign: 'center' }}>{formatDateDisplay(sale.date)}</td>
                      </tr>
                    </tbody>
                  </table>

                  {/* Acknowledgment */}
                  <div className="text-center pt-1">
                    <span className="border-b border-black font-extrabold text-[13px] pb-0.5">إقـــــــرار اسـتـلام</span>
                  </div>

                  <p className="text-justify text-[11px] leading-relaxed font-bold text-indent-6">
                    أقر أنا الموقع أدناه / <span className="border-b border-black px-1">{signatoryName}</span> المقيم / <span className="border-b border-black px-1">{signatoryAddress}</span> وأحمل بطاقة رقم قومي / <span className="border-b border-black px-1 font-mono">{signatoryNationalId}</span> بأنني قد استلمت السلعة المذكورة أعلاه جديدة وغير مستعملة وبحالة ممتازة بعد المعاينة التامة النافية للجهالة وقبلتها بحالتها وقت شراؤها، وأقر وأتعهد بالتزامي الكامل بسداد جميع الأقساط في مواعيد استحقاقها المحددة، وإذا تأخرت أو امتنعت عن السداد أعتبر مبدداً وخائناً للأمانة بقيمة السلعة المشتراة وهذا إقرار مني بذلك.
                  </p>

                  <div className="flex justify-between text-xs font-bold pt-2 px-2">
                    <span>توقيع المقر: .......................................</span>
                    <span>بصمة المقر:</span>
                  </div>
                </div>
              )}

              {/* Trust Receipt Preview */}
              {activePreviewTab === 'trustReceipt' && (
                <div className="bg-white text-black p-8 shadow-xl border border-slate-300 w-full max-w-[650px] space-y-8 rounded animate-in fade-in duration-200" style={{ fontFamily: 'Tahoma, sans-serif', direction: 'rtl' }}>
                  <div className="text-center">
                    <span className="border-2 border-black px-6 py-1.5 font-bold text-lg inline-block shadow-[3px_3px_0_black]">ايصال استلام نقدية على سبيل الامانه</span>
                  </div>

                  <div className="border-2 border-black p-8 rounded min-h-[350px] flex flex-col justify-between">
                    <p className="text-justify leading-loose text-sm font-bold">
                      استلمت انا السيد / <span className="border-b-2 border-black px-3">{signatoryName}</span><br/>
                      المقيم / <span className="border-b-2 border-black px-3">{signatoryAddress}</span><br/>
                      واحمل رقم قومى / <span className="border-b-2 border-black px-3">{signatoryNationalId}</span><br/>
                      من السيد / <span className="border-b-2 border-black px-3">{firstPartyName}</span><br/>
                      مبلغ وقدره ( <span className="font-mono text-md border-b-2 border-black px-2">{amount.toLocaleString('en-US')}</span> ) فقط <span className="border-b-2 border-black px-3">{amountInWords}</span><br/>
                      وذلك بصفة امانة لتسليمها الى السيد / <span className="border-b-2 border-black px-3">{thirdPartyName}</span><br/>
                      وذلك لرده للطالب حين طلبه واذا لم اقم برد المبلغ للطالب اعتبر مبددا وخائنا للامانه واتحمل المسئوليه الجنائيه والمدنيه نحو ارتكابى الجريمه المعاقب عليها قانونا.
                    </p>

                    <div className="flex justify-between text-sm font-bold pt-8 px-8">
                      <span>التوقيع</span>
                      <span>البصمة</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Receipt Acknowledgment Preview */}
              {activePreviewTab === 'receiptAck' && (
                <div className="bg-white text-black p-8 shadow-xl border border-slate-300 w-full max-w-[650px] space-y-8 rounded animate-in fade-in duration-200" style={{ fontFamily: 'Tahoma, sans-serif', direction: 'rtl' }}>
                  <div className="text-center">
                    <span className="border-2 border-black px-6 py-1.5 font-bold text-lg inline-block shadow-[3px_3px_0_black]">إقـــــــرار إستلام</span>
                  </div>

                  <div className="border-2 border-black p-8 rounded min-h-[350px] flex flex-col justify-between">
                    <p className="text-justify leading-loose text-xs font-bold text-indent-12">
                      اقر انا / <span className="border-b border-black px-2">{signatoryName}</span> المقيم / <span className="border-b border-black px-2">{signatoryAddress}</span> واحمل رقم قومى / <span className="border-b border-black px-2">{signatoryNationalId}</span> بأننى قد إستلمت المبلغ المدون به ايصال الامانه الموقع منى والمحرر على من السيد / <span className="border-b border-black px-2">{firstPartyName}</span> لصالح السيد / <span className="border-b border-black px-2">{thirdPartyName}</span> واننى قد استلمت هذا المبلغ نقدى وليس بضاعة وليس من حقى المنازعة بخصوص انتفاء ركن التسليم وذلك لاستلامى الفعلى لهذا المبلغ واننى ملزم برده نقدا كما اقر بان مادون بالإيصال من بيانات وكذلك التوقيع المنسوب صدوره لى صحيحين ولا يجوز لى الطعن بالتزوير عليهم امام المحكمة وفى حالة عدم الرد اكون مبددا وخائنا للامانه ولا يجوز شهادة الشهود فى اثبات وجود هذا المبلغ او الانقضاء ولا يجوز توجيه اليمين الحاسمة او اليمين المتممه منى او من وكلنى الى المستلم منى والدائن ولا تبرأ ذمتى الا بتقديم دليل كتابى يفيد سداد المبلغ المدون بهذا الايصال والموقع منى بالبصمة والامضاء الى المستفيد وفقا لنصوص قانون الاثبات.
                    </p>

                    <div className="flex justify-between text-sm font-bold pt-8 px-8">
                      <span>التوقيع</span>
                      <span>البصمة</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Lawyer Representation Preview */}
              {activePreviewTab === 'lawyerAck' && (
                <div className="bg-white text-black p-6 shadow-xl border border-slate-300 w-full max-w-[650px] space-y-4 rounded animate-in fade-in duration-200" style={{ fontFamily: 'Tahoma, sans-serif', direction: 'rtl' }}>
                  
                  {/* Repeated 3 times */}
                  {[1, 2, 3].map((num) => {
                    const actionType = num === 1 ? 'ومعارضه' : num === 2 ? 'استئناف' : 'ومعارضه استئنافيه';
                    return (
                      <div key={num} className="border border-slate-400 p-3 rounded space-y-2">
                        <div className="text-center">
                          <span className="border border-black px-4 py-0.5 font-bold text-xs inline-block shadow-[2px_2px_0_black]">إقـــــــرار</span>
                        </div>
                        <div className="border border-black p-3 space-y-1 rounded text-[11px] leading-relaxed">
                          <p className="font-bold">
                            اقر انا / <span className="border-b border-black px-2">{signatoryName}</span> واحمل رقم قومى / <span className="border-b border-black px-2">{signatoryNationalId}</span> ومقيم بناحية / <span className="border-b border-black px-2">{signatoryAddress}</span>
                          </p>
                          <p className="font-bold">
                            بأننى قد وكلت الاستاذ / <span className="border-b border-black px-2">{lawyerName}</span>
                          </p>
                          <p className="font-bold">
                            بعمل {actionType} فى القضية رقم ............................ لسنة ............................ جنح كفر الشيخ
                          </p>
                          <p className="font-bold">وهذا اقرار منى بذلك</p>
                          <p className="font-bold text-left pl-6 pt-1">المقر بما فيه /</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-end px-6 py-4 bg-slate-950 border-t border-slate-800 gap-3 shrink-0">
          <button
            onClick={onClose}
            className="rounded-2xl border border-slate-800 bg-transparent text-slate-300 hover:text-white hover:bg-slate-900 px-6 py-3 font-bold text-sm transition-colors"
          >
            إلغاء
          </button>

          {activeGuarantors.length > 0 && (
            <button
              onClick={() => handlePrint('all-parties')}
              className="inline-flex items-center gap-2 rounded-2xl bg-amber-500 hover:bg-amber-400 text-slate-950 px-6 py-3 font-black text-sm shadow-md transition-all shrink-0"
            >
              <Printer size={18} />
              طباعة شاملة للعميل والضامنين معاً
            </button>
          )}
          
          <button
            onClick={() => handlePrint('active')}
            className="inline-flex items-center gap-2 rounded-2xl bg-sky-500 hover:bg-sky-400 text-slate-950 px-6 py-3 font-black text-sm shadow-md transition-all shrink-0"
          >
            <Printer size={18} />
            {selectedSignatory === 'customer' ? 'طباعة مستندات العميل فقط' : 'طباعة مستندات هذا الضامن فقط'}
          </button>
        </div>
      </div>
    </div>
  );
}
