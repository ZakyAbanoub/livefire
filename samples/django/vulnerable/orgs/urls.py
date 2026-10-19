from django.urls import path

from . import admin_views, views

urlpatterns = [
    path("orgs", views.MyOrgListView.as_view()),
    path("orgs/<int:org_id>/members", views.OrgMemberListView.as_view()),
    path("admin/orgs/<int:org_id>/stats", admin_views.OrgStatsView.as_view()),
    path("admin/orgs/<int:org_id>/purge", admin_views.OrgPurgeView.as_view()),
]
