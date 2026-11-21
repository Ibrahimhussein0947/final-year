import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Layout } from '@/components/layout/Layout';
import { I18nProvider } from '@/i18n';
import { ThemeProvider } from '@/app/theme';
import { AuthProvider, RequireAuth } from '@/app/auth';
import { ToastProvider } from '@/app/toast';
import { RealtimeProvider } from '@/app/realtime';
import { PwaProvider } from '@/app/pwa';
import { MessagesPage } from '@/pages/Messages';
import AnalyticsPage from '@/pages/Analytics';
import { AdminLayout } from '@/pages/admin/AdminLayout';
import { AdminModeration, AdminOverview, AdminUsers, AdminVerification } from '@/pages/admin/pagesTrust';
import { AdminPerformance } from '@/pages/admin/pagesPerformance';
import { AdminAnalytics, AdminAudit, AdminMatching, AdminTaxonomy, AdminTranslations } from '@/pages/admin/pagesSystem';
import { AdminCriteria } from '@/pages/admin/pagesCriteria';
import { AdminOrganizations } from '@/pages/admin/pagesOrganizations';
import { AdminHiringRules } from '@/pages/admin/pagesHiring';
import { AdminTeam } from '@/pages/admin/pagesTeam';
import { AdminPlans } from '@/pages/admin/pagesPlans';
import { AdminTraining } from '@/pages/admin/pagesTraining';
import { AdminPlaces } from '@/pages/admin/pagesPlaces';
import { AdminAnnouncements, AdminJobs, AdminSettings, AdminUserDetail } from '@/pages/admin/pagesManage';
import Dashboard from '@/pages/Dashboard';
import WorkerProfilePage from '@/pages/worker/WorkerProfilePage';
import CvBuilderPage from '@/pages/worker/CvBuilder';
import InterviewsPage from '@/pages/Interviews';
import DocumentsPage from '@/pages/Documents';
import HiringBoardPage from '@/pages/employer/HiringBoard';
import ProfileViewsPage from '@/pages/worker/ProfileViews';
import OrganizationPage from '@/pages/employer/OrganizationPage';
import JobDetail from '@/pages/JobDetail';
import MyJobs from '@/pages/employer/MyJobs';
import JobFormPage from '@/pages/employer/JobForm';
import ApplicantsPage from '@/pages/employer/Applicants';
import CandidatePage from '@/pages/employer/Candidate';
import ComparePage from '@/pages/employer/Compare';
import { MyApplicationsPage, SavedJobsPage } from '@/pages/worker/Applications';
import RecommendedJobsPage from '@/pages/worker/Recommended';
import SkillTestsPage from '@/pages/worker/SkillTests';
import RecommendedWorkersPage, { WorkerProfileForEmployer } from '@/pages/employer/RecommendedWorkers';
import FindWorkersPage from '@/pages/employer/FindWorkers';
import Landing from '@/pages/Landing';
import Categories from '@/pages/Categories';
import { JobsPage, WorkersPage } from '@/pages/Browse';
import { ServiceDetailPage, ServicesPage } from '@/pages/Services';
import MyServicesPage from '@/pages/worker/MyServices';
import ServiceRequestsPage from '@/pages/ServiceRequests';
import { LoginPage, RegisterPage } from '@/pages/Auth';
import { ForgotPasswordPage } from '@/pages/PasswordReset';
import { SecurityPage } from '@/pages/Security';
import {
  AboutPage, ContactPage, InstallPage, HelpPage, HowItWorksPage, NotFoundPage, PrivacyPage, TermsPage,
} from '@/pages/Content';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } },
});

export default function App() {
  return (
    <ThemeProvider>
      <PwaProvider>
      <I18nProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
          <BrowserRouter>
          <ToastProvider>
          <RealtimeProvider>
            <Routes>
              <Route element={<Layout />}>
                <Route index element={<Landing />} />
                <Route path="jobs" element={<JobsPage />} />
                <Route path="workers" element={<WorkersPage />} />
                <Route path="services" element={<ServicesPage />} />
                <Route path="services/:id" element={<ServiceDetailPage />} />
                <Route path="my-services" element={<RequireAuth roles={['WORKER']}><MyServicesPage /></RequireAuth>} />
                <Route path="service-requests" element={<RequireAuth roles={['WORKER', 'EMPLOYER']}><ServiceRequestsPage /></RequireAuth>} />
                <Route path="categories" element={<Categories />} />
                <Route path="how-it-works" element={<HowItWorksPage />} />
                <Route path="install" element={<InstallPage />} />
                <Route path="about" element={<AboutPage />} />
                <Route path="help" element={<HelpPage />} />
                <Route path="contact" element={<ContactPage />} />
                <Route path="privacy" element={<PrivacyPage />} />
                <Route path="terms" element={<TermsPage />} />
                <Route path="login" element={<LoginPage />} />
                <Route path="register" element={<RegisterPage />} />
                <Route path="forgot-password" element={<ForgotPasswordPage />} />
                <Route path="documents" element={<RequireAuth roles={['WORKER', 'EMPLOYER']}><DocumentsPage /></RequireAuth>} />
                <Route path="interviews" element={<RequireAuth roles={['WORKER', 'EMPLOYER']}><InterviewsPage /></RequireAuth>} />
                <Route path="account/security" element={<RequireAuth><SecurityPage /></RequireAuth>} />
                <Route path="dashboard" element={<RequireAuth><Dashboard /></RequireAuth>} />
                <Route path="profile" element={<RequireAuth roles={['WORKER']}><WorkerProfilePage /></RequireAuth>} />
                <Route path="profile/views" element={<RequireAuth roles={['WORKER']}><ProfileViewsPage /></RequireAuth>} />
                <Route path="profile/cv" element={<RequireAuth roles={['WORKER']}><CvBuilderPage /></RequireAuth>} />
                <Route path="organization" element={<RequireAuth roles={['EMPLOYER']}><OrganizationPage /></RequireAuth>} />
                <Route path="jobs/:id" element={<JobDetail />} />
                <Route path="employer/jobs" element={<RequireAuth roles={['EMPLOYER']}><MyJobs /></RequireAuth>} />
                <Route path="employer/jobs/new" element={<RequireAuth roles={['EMPLOYER']}><JobFormPage /></RequireAuth>} />
                <Route path="employer/jobs/:id/edit" element={<RequireAuth roles={['EMPLOYER']}><JobFormPage /></RequireAuth>} />
                <Route path="employer/jobs/:id/board" element={<RequireAuth roles={['EMPLOYER']}><HiringBoardPage /></RequireAuth>} />
                <Route path="employer/jobs/:id/applications" element={<RequireAuth roles={['EMPLOYER']}><ApplicantsPage /></RequireAuth>} />
                <Route path="employer/jobs/:id/compare" element={<RequireAuth roles={['EMPLOYER']}><ComparePage /></RequireAuth>} />
                <Route path="employer/applications/:id" element={<RequireAuth roles={['EMPLOYER']}><CandidatePage /></RequireAuth>} />
                <Route path="employer/jobs/:id/recommended" element={<RequireAuth roles={['EMPLOYER']}><RecommendedWorkersPage /></RequireAuth>} />
                <Route path="employer/workers" element={<RequireAuth roles={['EMPLOYER']}><FindWorkersPage /></RequireAuth>} />
                <Route path="employer/workers/:id" element={<RequireAuth roles={['EMPLOYER']}><WorkerProfileForEmployer /></RequireAuth>} />
                <Route path="analytics" element={<RequireAuth roles={['WORKER', 'EMPLOYER']}><AnalyticsPage /></RequireAuth>} />
                <Route path="admin" element={<RequireAuth roles={['ADMIN']}><AdminLayout /></RequireAuth>}>
                  <Route index element={<AdminOverview />} />
                  <Route path="users" element={<AdminUsers />} />
                  <Route path="users/:id" element={<AdminUserDetail />} />
                  <Route path="announcements" element={<AdminAnnouncements />} />
                  <Route path="jobs" element={<AdminJobs />} />
                  <Route path="settings" element={<AdminSettings />} />
                  <Route path="verification" element={<AdminVerification />} />
                  <Route path="moderation" element={<AdminModeration />} />
                  <Route path="taxonomy" element={<AdminTaxonomy />} />
                  <Route path="criteria" element={<AdminCriteria />} />
                  <Route path="hiring" element={<AdminHiringRules />} />
                  <Route path="team" element={<AdminTeam />} />
                  <Route path="plans" element={<AdminPlans />} />
                  <Route path="training" element={<AdminTraining />} />
                  <Route path="places" element={<AdminPlaces />} />
                  <Route path="organizations" element={<AdminOrganizations />} />
                  <Route path="translations" element={<AdminTranslations />} />
                  <Route path="matching" element={<AdminMatching />} />
                  <Route path="performance" element={<AdminPerformance />} />
                  <Route path="analytics" element={<AdminAnalytics />} />
                  <Route path="audit" element={<AdminAudit />} />
                </Route>
                <Route path="messages" element={<RequireAuth roles={['WORKER', 'EMPLOYER']}><MessagesPage /></RequireAuth>} />
                <Route path="messages/:id" element={<RequireAuth roles={['WORKER', 'EMPLOYER']}><MessagesPage /></RequireAuth>} />
                <Route path="recommended" element={<RequireAuth roles={['WORKER']}><RecommendedJobsPage /></RequireAuth>} />
                <Route path="skill-tests" element={<RequireAuth roles={['WORKER']}><SkillTestsPage /></RequireAuth>} />
                <Route path="applications" element={<RequireAuth roles={['WORKER']}><MyApplicationsPage /></RequireAuth>} />
                <Route path="saved" element={<RequireAuth roles={['WORKER']}><SavedJobsPage /></RequireAuth>} />
                <Route path="*" element={<NotFoundPage />} />
              </Route>
            </Routes>
          </RealtimeProvider>
          </ToastProvider>
          </BrowserRouter>
          </AuthProvider>
        </QueryClientProvider>
      </I18nProvider>
      </PwaProvider>
    </ThemeProvider>
  );
}
