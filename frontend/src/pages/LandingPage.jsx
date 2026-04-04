import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Menu, ShieldPlus } from 'lucide-react';
import { Link } from 'react-router-dom';
import arrivalConfirmedImage from '../assets/arrivalconfirmed.png';
import describeEmergencyImage from '../assets/describeemergency.png';
import massCasualtyImage from '../assets/masscasualty.png';

const ambulanceBackdropImage =
  'https://www.figma.com/api/mcp/asset/abc464bb-5b55-4f45-9309-662da1417b86';

const galleryImages = [
  '/vitalinq-landing/Rectangle-11@2x.png',
  '/vitalinq-landing/Rectangle-1@2x.png',
  '/vitalinq-landing/Rectangle-14@2x.png',
  '/vitalinq-landing/Rectangle-12@2x.png',
  '/vitalinq-landing/Rectangle-13@2x.png',
];

const faqs = [
  {
    question: 'Is this available outside Lagos?',
    answer:
      'Vitalinq is being designed for Nigeria-wide emergency coordination, but rollout starts city by city. Lagos is the current focus while the network expands to more hospitals and regions.',
  },
  {
    question: 'What if no beds are available near me?',
    answer:
      'Vitalinq helps widen the search and surface the next-best available options quickly, so responders and families can act on real alternatives instead of starting the search over from scratch.',
  },
  {
    question: 'Does this work without a smartphone?',
    answer:
      'The product is built to be accessible to anyone with a phone, with flows that can support families, responders, and hospital teams coordinating across simple mobile devices.',
  },
  {
    question: 'What if a hospital cancels my reservation?',
    answer:
      'If availability changes, the system can immediately push the search back into motion and help redirect the patient to another suitable hospital with less delay.',
  },
  {
    question: 'Is Vitalinq a government service?',
    answer:
      'Vitalinq is a live hospital bed availability network, not a government hotline. It works by connecting patients and responders to verified participating facilities in real time.',
  },
];

const footerColumns = [
  {
    title: 'Platform',
    links: ['Find a bed', 'Report emergency', 'Reservation flow', 'Ambulance support'],
  },
  {
    title: 'For Hospitals',
    links: ['Join the network', 'Bed updates', 'Capacity management', 'Operations'],
  },
  {
    title: 'Resources',
    links: ['FAQs', 'Support', 'About', 'Contact'],
  },
  {
    title: 'Coverage',
    links: ['Lagos', 'Abuja', 'Port Harcourt', 'Nigeria'],
  },
];

function GridBand() {
  return (
    <div className="grid-band relative h-[110px] w-full overflow-hidden bg-[#081322] mix-blend-screen">
      <div
        className="absolute inset-0 opacity-[0.18]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.08) 1px, transparent 1px)',
          backgroundSize: '18px 18px',
        }}
      />
      <div
        className="absolute inset-0 opacity-[0.12]"
        style={{
          backgroundImage:
            'radial-gradient(circle, rgba(255,255,255,0.22) 1px, transparent 1px)',
          backgroundSize: '56px 56px',
          backgroundPosition: '28px 28px',
        }}
      />
    </div>
  );
}

function StepBadge({ children }) {
  return (
    <div className="inline-flex rounded-full bg-[rgba(21,48,255,0.1)] px-3 py-0.5 text-[14px] font-medium uppercase leading-6 text-[#1530ff]">
      {children}
    </div>
  );
}

function RevealHeading({ as: Tag = 'h2', className = '', delay = 0, children }) {
  const ref = useRef(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.2, rootMargin: '0px 0px -8% 0px' },
    );

    observer.observe(node);

    return () => observer.disconnect();
  }, []);

  return (
    <Tag
      ref={ref}
      className={`${isVisible ? 'heading-reveal is-visible' : 'heading-reveal'} ${className}`}
      style={{ animationDelay: `${delay}ms` }}
    >
      {children}
    </Tag>
  );
}

function StepText({ number, title, body }) {
  return (
    <div className="w-full max-w-[518px]">
      <StepBadge>{number}</StepBadge>
      <RevealHeading as="h3" className="mt-3 text-[24px] font-semibold leading-[1.32] tracking-[-0.02em] text-[#081322] sm:text-[28px] lg:text-[32px]">
        {title}
      </RevealHeading>
      <p className="mt-2 text-[16px] font-normal leading-[1.55] text-[#081322cc] sm:text-[18px] lg:text-[20px]">
        {body}
      </p>
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="bg-[#081322] font-[Figtree,sans-serif] text-white">
      <header className="bg-[#0c1c32]">
        <div className="mx-auto flex w-full max-w-[1440px] items-center px-5 py-6 lg:px-[84px]">
          <Link to="/" className="inline-flex items-center gap-2 transition duration-300 hover:scale-[1.02]">
            <img className="h-6 w-6" src="/vitalinq-landing/Group-1.svg" alt="Vitalinq" decoding="async" />
            <span className="text-[22px] font-bold leading-[1.45] tracking-[-0.02em] text-white">vitalinq</span>
          </Link>

          <div className="ml-auto hidden items-center gap-6 lg:flex">
            <nav className="items-center gap-6 lg:flex">
              <Link
                to="/login"
                className="inline-flex items-center gap-2 rounded-lg text-[16px] font-medium leading-[1.45] text-white/70 transition duration-300 hover:-translate-y-0.5 hover:text-white"
              >
                For Hospitals
                <ChevronDown size={18} strokeWidth={2.1} />
              </Link>
              <Link
                to="/dispatch/lasema"
                className="inline-flex items-center gap-2 rounded-lg text-[16px] font-medium leading-[1.45] text-white/70 transition duration-300 hover:-translate-y-0.5 hover:text-white"
              >
                For Dispatch
                <ChevronDown size={18} strokeWidth={2.1} />
              </Link>
            </nav>

            <div className="hidden items-center gap-3 md:flex">
              <Link
                to="/broadcast/new"
                className="landing-button rounded-full bg-[#112138] px-5 py-3 text-[16px] font-semibold leading-[1.45] text-white transition hover:bg-[#1a2b44]"
              >
                Report Mass Casualty
              </Link>
              <Link
                to="/map"
                className="landing-button rounded-full bg-[#1530ff] px-5 py-3 text-[16px] font-semibold leading-[1.45] text-white transition hover:bg-[#2942ff]"
              >
                Find a bed now
              </Link>
            </div>
          </div>

          <button type="button" className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/8 md:hidden">
            <Menu size={18} />
          </button>
        </div>
      </header>

      <main>
        <section className="relative overflow-hidden px-5 pb-20 pt-12 lg:px-8 lg:pt-16">
          <div className="absolute left-1/2 top-[18rem] h-[28rem] w-[76rem] -translate-x-1/2 rounded-full bg-[#1530ff33] blur-[120px]" />
          <div className="mx-auto max-w-[1280px]">
            <div className="mx-auto max-w-[760px] text-center">
              <div className="motion-rise inline-flex rounded-full bg-[#112138] px-4 py-2 text-xs font-medium uppercase tracking-[0.15em] text-white/70 [animation-delay:80ms]">
                Nigeria&apos;s first real-time hospital bed availability network.
              </div>
              <RevealHeading as="h1" delay={160} className="mt-6 text-[2.2rem] font-semibold leading-[1.08] tracking-[-0.03em] sm:text-[2.9rem] lg:text-[4rem]">
                Find an available hospital bed near you, right now.
              </RevealHeading>
              <p className="motion-rise mt-6 text-[16px] leading-7 text-white/80 [animation-delay:240ms] sm:text-lg sm:leading-8 lg:text-xl">
                We connect patients, families, and emergency responders to verified available beds, across hospitals, across bed types, across the city in seconds.
              </p>
              <div className="motion-rise mt-8 flex flex-col items-center justify-center gap-3 [animation-delay:320ms] sm:flex-row">
                <Link to="/map" className="landing-button rounded-full bg-[#1530ff] px-8 py-4 text-sm font-semibold text-white">
                  Find a Bed Now
                </Link>
                <Link to="/broadcast/new" className="landing-button rounded-full bg-[#112138b3] px-8 py-4 text-sm font-semibold text-white">
                  Report Mass Casualty
                </Link>
              </div>
            </div>

            <div className="motion-rise relative mx-auto mt-16 max-w-[1160px] [animation-delay:400ms]">
              <img
                className="hero-media relative z-10 w-full rounded-[2rem] object-cover shadow-[0_30px_100px_rgba(0,0,0,0.35)]"
                src="/vitalinq-landing/Screenshot-2026-04-01-at-23-28-38-1@2x.png"
                alt="Vitalinq landing hero preview"
                decoding="async"
                fetchPriority="high"
              />
            </div>
          </div>
        </section>

        <section className="relative overflow-hidden bg-[#081322]">
          <GridBand />

          <div className="mx-auto flex max-w-[1440px] flex-col items-center gap-[38px] px-5 py-14 text-center lg:px-8">
            <div className="flex justify-center p-[10px]">
              <RevealHeading as="h2" delay={120} className="w-full max-w-[964px] text-center text-[1.8rem] font-semibold leading-[1.34] tracking-[-0.02em] text-white sm:text-[2.1rem] lg:text-[36px]">
                Every year, Nigerians die in <span className="text-white/70">hospital corridors</span>, in <span className="text-white/70">ambulances</span>, and <span className="text-white/70">on the street</span>, not because medicine couldn&apos;t save them, but because <span className="text-white/70">no one knew which hospital had a bed.</span>
              </RevealHeading>
            </div>

            <div className="relative hidden h-[335px] w-[1432px] max-w-full lg:block">
              <div className="story-card absolute left-0 top-0 bg-white px-[10px] pb-[24px] pt-[12px]">
                <img className="h-[230px] w-[228px] object-cover transition duration-500 group-hover:scale-[1.04]" src={galleryImages[0]} alt="" loading="lazy" decoding="async" />
              </div>
              <div className="story-card absolute left-[296px] top-[34px] bg-white px-[10px] pb-[24px] pt-[12px]">
                <img className="h-[230px] w-[228px] object-cover" src={galleryImages[1]} alt="" loading="lazy" decoding="async" />
              </div>
              <div className="story-card absolute left-[592px] top-[69px] bg-white px-[10px] pb-[24px] pt-[12px]">
                <img className="h-[230px] w-[228px] object-cover" src={galleryImages[2]} alt="" loading="lazy" decoding="async" />
              </div>
              <div className="story-card absolute left-[888px] top-[34px] bg-white px-[10px] pb-[24px] pt-[12px]">
                <img className="h-[230px] w-[228px] object-cover" src={galleryImages[3]} alt="" loading="lazy" decoding="async" />
              </div>
              <div className="story-card absolute left-[1184px] top-0 bg-white px-[10px] pb-[24px] pt-[12px]">
                <img className="h-[230px] w-[228px] object-cover" src={galleryImages[4]} alt="" loading="lazy" decoding="async" />
              </div>
            </div>

            <div className="grid w-full max-w-[760px] grid-cols-2 gap-4 lg:hidden">
              {galleryImages.map((image, index) => (
                <figure
                  key={image}
                  className={`story-card overflow-hidden bg-white px-[10px] pb-[24px] pt-[12px] ${index === galleryImages.length - 1 ? 'col-span-2 mx-auto w-full max-w-[248px]' : ''}`}
                >
                  <img className="h-[230px] w-full object-cover" src={image} alt="" loading="lazy" decoding="async" />
                </figure>
              ))}
            </div>

            <div className="flex justify-center p-[10px]">
              <p className="w-full max-w-[720px] text-center text-[16px] font-medium leading-[1.6] text-white/80 sm:text-[18px] lg:text-[20px]">
                Doctors are present. Ambulances respond. Equipment is available. But the information that connects a patient to the right facility in time does not exist.
              </p>
            </div>
          </div>

          <GridBand />
        </section>

        <section className="relative overflow-hidden bg-[#f3f8ff] py-20 text-[#081322] lg:py-24">
          <div className="pointer-events-none absolute left-[-298px] top-1/2 hidden h-[600px] w-[600px] -translate-y-1/2 opacity-10 mix-blend-hard-light lg:block">
            <img className="h-full w-full object-contain" src="/vitalinq-landing/Group-4.svg" alt="" />
          </div>
          <div className="pointer-events-none absolute right-[-298px] top-1/2 hidden h-[600px] w-[600px] -translate-y-1/2 opacity-10 mix-blend-hard-light lg:block">
            <img className="h-full w-full object-contain" src="/vitalinq-landing/Group-4.svg" alt="" />
          </div>

          <div className="relative mx-auto flex max-w-[924px] flex-col items-center gap-6 px-5 text-center lg:px-8">
            <img className="h-[100px] w-[100px]" src="/vitalinq-landing/Group-11.svg" alt="" loading="lazy" decoding="async" />
            <div className="flex flex-col items-center gap-6">
              <RevealHeading as="h2" delay={140} className="text-[1.9rem] font-semibold leading-[1.34] tracking-[-0.02em] text-[#081322] sm:text-[2.2rem] lg:text-[36px]">
                Vitalinq is Nigeria&apos;s first real-time hospital bed availability network. It connects patients, families, and emergency responders to verified available beds across hospitals, across bed types, across the city in seconds.
              </RevealHeading>
              <p className="max-w-[724px] text-[16px] font-medium leading-[1.6] text-[#081322cc] sm:text-[18px] lg:text-[20px]">
                It is not a directory. It is not a helpline. It is a live system, updated continuously by the hospitals themselves, accessible to anyone with a phone.
              </p>
            </div>
          </div>
        </section>

        <section id="how-it-works" className="bg-white text-[#081322]">
          <div className="mx-auto max-w-[1440px] px-5 py-8 lg:px-8">
            <section className="step-stack-card grid items-center gap-8 py-6 lg:min-h-[559px] lg:grid-cols-[518px_636px] lg:justify-center lg:gap-[122px] lg:py-8" style={{ zIndex: 1 }}>
              <StepText
                number="Step 1"
                title="Describe your emergency"
                body="Type what is happening - symptoms, condition, urgency. Vitalinq's triage system reads your description and identifies the bed type you need: ICU, surgical, maternity, paediatric, or general ward."
              />
              <div className="step-media overflow-hidden rounded-[12px]">
                <img
                  className="h-full min-h-[320px] w-full object-cover"
                  src={describeEmergencyImage}
                  alt="Describe your emergency"
                  loading="lazy"
                  decoding="async"
                />
              </div>
            </section>

            <section className="step-stack-card grid items-center gap-8 py-6 lg:min-h-[559px] lg:grid-cols-[636px_518px] lg:justify-center lg:gap-[122px] lg:py-8" style={{ zIndex: 2 }}>
              <div className="step-media overflow-hidden rounded-[12px]">
                <img
                  className="h-full min-h-[320px] w-full object-cover"
                  src="/vitalinq-landing/Group-9@2x.png"
                  alt="Available hospitals near you"
                  loading="lazy"
                  decoding="async"
                />
              </div>
              <StepText
                number="Step 2"
                title="See what's available near you"
                body="A ranked list of hospitals with available beds appears - sorted by distance, bed type match, and current availability. Real data. Updated in real time."
              />
            </section>

            <section className="step-stack-card grid items-center gap-8 py-6 lg:min-h-[559px] lg:grid-cols-[518px_636px] lg:justify-center lg:gap-[122px] lg:py-8" style={{ zIndex: 3 }}>
              <StepText
                number="Step 3"
                title="Reserve your bed"
                body="Select a hospital and hold a bed. You receive a transfer code. The hospital is notified immediately. Your bed is held while you travel."
              />
              <div className="step-media overflow-hidden rounded-[12px]">
                <img
                  className="h-full min-h-[320px] w-full object-cover"
                  src="/vitalinq-landing/Group-10@2x.png"
                  alt="Reserve your bed"
                  loading="lazy"
                  decoding="async"
                />
              </div>
            </section>

            <section className="step-stack-card grid items-center gap-8 py-6 lg:min-h-[559px] lg:grid-cols-[636px_518px] lg:justify-center lg:gap-[122px] lg:py-8" style={{ zIndex: 4 }}>
              <div className="step-media overflow-hidden rounded-[12px]">
                <img
                  className="h-full min-h-[320px] w-full object-cover"
                  src={arrivalConfirmedImage}
                  alt="Get there with confirmation"
                  loading="lazy"
                  decoding="async"
                />
              </div>
              <StepText
                number="Step 4"
                title="Get there with confirmation"
                body="Your emergency contact receives a WhatsApp notification the moment your bed is confirmed."
              />
            </section>
          </div>
        </section>

        <section className="relative overflow-hidden bg-[#081322] px-5 py-24 text-center lg:px-8">
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(8,19,34,0.58),rgba(8,19,34,0.82))]" />
          <div className="absolute inset-0 opacity-50 mix-blend-soft-light">
            <img className="h-full w-full object-cover" src={ambulanceBackdropImage} alt="" loading="lazy" decoding="async" />
          </div>

          <div className="relative mx-auto flex max-w-[647px] flex-col items-center gap-16">
            <div className="max-w-[647px]">
              <RevealHeading as="h2" className="text-[2rem] font-semibold leading-[1.22] tracking-[-0.02em] text-white sm:text-[2.5rem] lg:text-[48px]">
                Need an ambulance?
              </RevealHeading>
              <p className="motion-rise mt-3 text-[16px] font-normal leading-[1.6] text-white/80 [animation-delay:120ms] sm:text-[18px] lg:text-[20px]">
                BedSignal coordinates transport, including escalation to a private dispatch company if the hospital&apos;s own fleet is unavailable.
              </p>
            </div>

            <div className="hero-device motion-rise w-full max-w-[414px] rounded-[12px] border-[6px] border-white/50 [animation-delay:220ms]">
              <div className="overflow-hidden rounded-[6px]">
                <img
                  className="h-[560px] w-full object-cover object-center lg:h-[663px]"
                  src="/vitalinq-landing/screencapture-localhost-5173-ambulance-191831f9-44f6-4a13-bf61-bc437fba5e46-crew-2026-04-02-03-00-02-1@2x.png"
                  alt="Ambulance request screen"
                  loading="lazy"
                  decoding="async"
                />
              </div>
            </div>
          </div>
        </section>

        <section className="bg-white px-5 py-20 lg:px-8">
          <div className="mx-auto max-w-[1442px]">
            <div className="overflow-hidden rounded-[24px] bg-[#020085]">
              <div className="relative pl-0 lg:min-h-[792px] lg:pl-[84px]">
                <div className="grid gap-8 p-5 sm:p-6 lg:grid-cols-[518px_1fr] lg:items-center lg:gap-0 lg:p-0">
                  <div className="motion-rise rounded-[16px] border border-white/20 px-6 py-8 [animation-delay:100ms] sm:px-8 sm:py-10 lg:px-12 lg:py-16">
                    <div className="flex flex-col items-start gap-3">
                      <div className="inline-flex items-center justify-center rounded-[100px] bg-white/20 px-4 py-1.5">
                        <span className="text-[14px] font-medium uppercase leading-[21px] tracking-[0.02em] text-white">
                          Mass Casualty &amp; Emergency Coordination
                        </span>
                      </div>

                      <div className="flex flex-col items-start gap-8">
                        <div className="flex flex-col items-start gap-3">
                          <RevealHeading
                            as="h2"
                            delay={120}
                            className="text-left text-[24px] font-semibold leading-[1.24] tracking-[-0.02em] text-white sm:text-[28px] lg:text-[32px] lg:leading-[44.8px]"
                          >
                            For road accidents, building collapses, and multi-casualty incidents involving more than one patient
                          </RevealHeading>

                          <p className="text-left text-[16px] font-normal leading-[1.65] text-white/80 sm:text-[18px] lg:text-[20px] lg:leading-[30px]">
                            Vitalinq&apos;s broadcast system allows field coordinators and emergency responders to log multiple casualties simultaneously, ping all hospitals within range, and distribute patients across facilities based on real-time bed availability — from a single screen.
                          </p>
                        </div>

                        <Link
                          to="/broadcast/new"
                          className="landing-button inline-flex items-center justify-center rounded-[100px] bg-white px-8 py-4 text-center text-[16px] font-semibold leading-[23.2px] text-[#1530FF]"
                        >
                          Open Emergency Broadcast →
                        </Link>
                      </div>
                    </div>
                  </div>

                  <div className="relative h-[300px] overflow-hidden sm:h-[360px] lg:h-[792px]">
                    <div className="absolute inset-y-0 right-0 w-full rounded-r-[24px] bg-[#020085]" />
                    <img
                      className="mass-casualty-visual absolute bottom-0 left-1/2 z-10 w-[132%] max-w-none -translate-x-[46%] object-contain sm:w-[118%] lg:left-auto lg:right-[-8%] lg:w-[755px] lg:translate-x-0"
                      src={massCasualtyImage}
                      alt="Mass casualty emergency coordination broadcast dashboard"
                      loading="lazy"
                      decoding="async"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="faq" className="bg-[linear-gradient(180deg,#ffffff_0%,#f7faff_100%)] px-5 py-20 text-[#081322] lg:px-8">
          <div className="mx-auto max-w-[1120px]">
            <div className="text-center">
              <div className="inline-flex rounded-full border border-[#d8e3ff] bg-[#edf3ff] px-4 py-1.5 text-xs font-medium uppercase tracking-[0.18em] text-[#1530ff]">
                FAQ
              </div>
              <RevealHeading as="h2" delay={100} className="mt-5 text-[2rem] font-semibold leading-[1.2] tracking-[-0.02em] sm:text-[2.3rem] lg:text-[44px]">
                Frequently Asked Questions
              </RevealHeading>
              <p className="mx-auto mt-3 max-w-[640px] text-[16px] leading-7 text-[#081322b8] sm:text-lg sm:leading-8">
                Clear answers for patients, families, and responders using Vitalinq during urgent moments.
              </p>
            </div>

            <div className="mt-14 grid gap-4">
              {faqs.map((faq, index) => (
                <details
                  key={faq.question}
                  className="faq-card group overflow-hidden rounded-[24px] border border-[#dfe7f7] bg-white shadow-[0_12px_40px_rgba(12,29,74,0.06)] transition duration-300 open:border-[#c8d7ff] open:shadow-[0_20px_60px_rgba(21,48,255,0.08)]"
                >
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-6 px-6 py-6 text-left transition duration-300 group-hover:bg-[#f8fbff] lg:px-8">
                    <div className="flex items-start gap-4">
                      <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#edf3ff] text-xs font-semibold text-[#1530ff]">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <span className="text-[17px] font-semibold leading-7 text-[#081322] sm:text-lg lg:text-[22px]">
                        {faq.question}
                      </span>
                    </div>
                    <span className="faq-icon inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[#d8e3ff] bg-[#f8fbff] text-[#1530ff] transition duration-300">
                      <ChevronRight size={20} />
                    </span>
                  </summary>

                  <div className="faq-content grid transition-all duration-300 ease-out">
                    <div className="overflow-hidden">
                      <div className="px-6 pb-6 lg:px-8 lg:pb-8">
                        <div className="ml-12 max-w-[720px] border-l border-[#dfe7f7] pl-6 text-[15px] leading-7 text-[#081322b8] sm:text-base sm:leading-8 lg:text-[17px]">
                          {faq.answer}
                        </div>
                      </div>
                    </div>
                  </div>
                </details>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="bg-[#050d19] px-5 py-20 text-[#cdc4c4] lg:px-8">
        <div className="mx-auto grid max-w-[1280px] gap-10 lg:grid-cols-[1.1fr_repeat(4,1fr)]">
          <div>
            <div className="inline-flex items-center gap-2.5">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/5">
                <ShieldPlus size={18} />
              </span>
              <span className="text-xl font-semibold text-white">Vitalinq</span>
            </div>
            <p className="mt-5 max-w-[18rem] text-sm leading-7 text-[#cdc4c4b3]">
              A real-time hospital bed availability network for emergency care coordination across Nigeria.
            </p>
          </div>

          {footerColumns.map((column) => (
            <div key={column.title}>
              <h3 className="text-base font-medium text-[#cdc4c4]">{column.title}</h3>
              <div className="mt-5 space-y-3 text-sm text-[#645d5d]">
                {column.links.map((link) => (
                  <p key={link}>{link}</p>
                ))}
              </div>
            </div>
          ))}
        </div>
      </footer>
    </div>
  );
}
